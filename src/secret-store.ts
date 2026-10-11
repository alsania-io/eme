// EME Storage Router — Phase 3: Secrets Layer.
// SecretStore persists secret PAYLOADS encrypted via an rclone `crypt` remote,
// and keeps a METADATA-ONLY index (name/namespace/tags) for discovery.
//
// Hard rules (Task 003 / master plan §6):
// - Secret payloads never touch Qdrant, logs, or tool output.
// - No custom crypto — rclone crypt does the encryption at rest.
// - The crypt password is read from env/secret input, never hardcoded/logged.
// - ACL is Phase 4; this layer exposes a deny-by-default `canAccess` hook.

import fs from "fs/promises";
import path from "path";
import os from "os";
import { RcloneBackend } from "./rclone-backend.js";

export interface SecretMeta {
  name: string;
  namespace: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SecretStoreOptions {
  /** rclone crypt remote, e.g. "secret-crypt:eme-secrets" */
  cryptRemote: string;
  /** Local staging + metadata index dir. */
  localPath: string;
  /** EME-managed rclone.conf path (crypt remote lives here). */
  rcloneConfigPath?: string;
}

/**
 * Permission hook. Defaults to DENY. Phase 4 replaces this with the real ACL
 * model; keep it the SINGLE choke point for agent access.
 */
export type CanAccess = (secret: SecretMeta, agentId?: string) => boolean;

export const denyAll: CanAccess = () => false;

export class SecretStore {
  private cryptRemote: string;
  private basePath: string;
  private indexPath: string;
  private rclone: RcloneBackend;
  private canAccess: CanAccess;
  private initialized = false;
  private index = new Map<string, SecretMeta>();

  constructor(
    opts: SecretStoreOptions,
    deps: { rclone?: RcloneBackend; canAccess?: CanAccess } = {},
  ) {
    if (!opts.cryptRemote) {
      throw new Error("SecretStore requires a crypt remote (e.g. 'secret-crypt:eme-secrets')");
    }
    this.cryptRemote = opts.cryptRemote.replace(/\/$/, "");
    this.basePath = opts.localPath;
    this.indexPath = path.join(this.basePath, "secrets-index.json");
    const base = deps.rclone ?? new RcloneBackend();
    this.rclone =
      typeof (base as any).withConfig === "function"
        ? (base as any).withConfig(opts.rcloneConfigPath)
        : base;
    this.canAccess = deps.canAccess ?? denyAll;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.basePath, { recursive: true });
    try {
      const raw = await fs.readFile(this.indexPath, "utf-8");
      const parsed = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed)) {
        this.index.set(k, v as SecretMeta);
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[SecretStore] index load: ${err.message}`);
      }
    }
    this.initialized = true;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private indexKey(name: string, namespace: string): string {
    return `${namespace}/${name}`;
  }

  /** Persist the METADATA-ONLY index (never payloads). */
  private async saveIndex(): Promise<void> {
    const obj = Object.fromEntries(this.index);
    await fs.writeFile(this.indexPath, JSON.stringify(obj, null, 2));
  }

  /** Resolve a secret's encrypted file path on the crypt remote. */
  private remotePath(meta: SecretMeta): string {
    return `${this.cryptRemote}/${meta.namespace}/${meta.name}.secret`;
  }

  /**
   * Encrypt-and-store a secret. Writes the payload via the crypt remote and
   * records METADATA ONLY in the index. Returns the metadata (never the value).
   */
  async put(
    name: string,
    value: string,
    opts: { namespace?: string; tags?: string[] } = {},
  ): Promise<SecretMeta> {
    await this.ensureInit();
    const namespace = opts.namespace ?? "default";
    const key = this.indexKey(name, namespace);
    const now = Date.now();
    const existing = this.index.get(key);
    const meta: SecretMeta = {
      name,
      namespace,
      tags: opts.tags ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    // Stage the plaintext payload in a temp file OUTSIDE the index dir, copy it
    // through the crypt remote (encryption happens in rclone), then shred.
    const stage = path.join(os.tmpdir(), `eme-secret-${process.pid}-${now}.tmp`);
    await fs.writeFile(stage, value, { mode: 0o600 });
    try {
      // rclone copyto maps the staged file to the exact encrypted name.
      const res = await this.rclone.run([
        "copyto",
        stage,
        this.remotePath(meta),
      ]);
      if (!res.ok) {
        throw new Error(`crypt copyto failed: ${res.stderr.trim()}`);
      }
    } finally {
      // Shred the plaintext staging file regardless of outcome.
      await fs.rm(stage, { force: true });
    }

    this.index.set(key, meta);
    await this.saveIndex();
    return meta;
  }

  /**
   * Retrieve and decrypt a secret. The value is returned to the CALLER ONLY —
   * never logged, never indexed, never written to disk in plaintext.
   */
  async get(name: string, opts: { namespace?: string } = {}): Promise<string | null> {
    await this.ensureInit();
    const namespace = opts.namespace ?? "default";
    const meta = this.index.get(this.indexKey(name, namespace));
    if (!meta) return null;

    const stage = path.join(os.tmpdir(), `eme-secret-out-${process.pid}-${Date.now()}.tmp`);
    try {
      const res = await this.rclone.run([
        "copyto",
        this.remotePath(meta),
        stage,
      ]);
      if (!res.ok) return null;
      return await fs.readFile(stage, "utf-8");
    } finally {
      await fs.rm(stage, { force: true });
    }
  }

  /**
   * The single ACL choke point. Returns whether `agentId` may read `name`.
   * Defaults to deny (denyAll). Phase 4 replaces the hook, not this call site.
   */
  async checkAccess(name: string, namespace = "default", agentId?: string): Promise<boolean> {
    await this.ensureInit();
    const meta = this.index.get(this.indexKey(name, namespace));
    if (!meta) return false;
    return this.canAccess(meta, agentId);
  }

  /** Metadata-only listing — NEVER includes values. */
  async list(opts: { namespace?: string } = {}): Promise<SecretMeta[]> {
    await this.ensureInit();
    const all = Array.from(this.index.values());
    return opts.namespace ? all.filter((m) => m.namespace === opts.namespace) : all;
  }

  /**
   * Replace `${NAME}` tokens with values from the store. Tokens not present in
   * the store are left untouched (env expansion is expected to have run first).
   * Returns the resolved string; unresolved tokens are preserved verbatim.
   */
  async resolve(text: string, opts: { namespace?: string } = {}): Promise<string> {
    await this.ensureInit();
    const tokenRe = /\$\{([A-Z0-9_]+)\}/g;
    const names = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(text)) !== null) names.add(m[1]);
    if (names.size === 0) return text;

    const resolved = new Map<string, string>();
    for (const name of names) {
      const value = await this.get(name, opts);
      if (value !== null) resolved.set(name, value);
    }

    return text.replace(tokenRe, (full, name) =>
      resolved.has(name) ? resolved.get(name)! : full,
    );
  }
}

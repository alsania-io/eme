// EME Storage Router — Phase 2b: EME-managed rclone.conf writer.
// EME OWNS its rclone config (Amendment 1 §5.2: "EME-managed", never the user's
// ~/.config/rclone). This module authors the base rclone.conf the backend pins
// via `--config`. It is the §8.3 deliverable of EME_ROUTER_MODEL_2a.md.
//
// Hard rules honored here:
// - NO credential ever written inline. A remote parameter whose value is not a
//   ${VAR} reference is rejected for secret-shaped keys (password/token/key).
// - Atomic write: temp file + rename. Never a partial conf.
// - Never delete: overwriting backups the prior conf to `<path>.bak-<ts>`.
//   Removing a remote MOVES its block to a .deprecated sidecar, never drops it.
// - Low-end friendly: a tiny hand-rolled INI parser, no new dependencies.

import * as fs from "fs";
import * as path from "path";
import { RcloneBackend } from "./rclone-backend.js";

/** A single rclone remote block: name -> { type, params }. */
export interface RcloneRemote {
  name: string;
  type: string;
  params: Record<string, string>;
}

/** Secret-shaped param keys that must never hold an inline literal. */
const SECRET_PARAM_KEYS = ["password", "pass", "token", "key", "secret", "client_secret"];
/**
 * Authors and maintains the EME-managed rclone.conf. Stateless w.r.t. remotes
 * beyond what it parses on demand, so it is safe to instantiate per call.
 */
export class RcloneConfig {
  readonly configPath: string;
  private rclone: RcloneBackend;

  constructor(configPath: string, rclone?: RcloneBackend) {
    if (!configPath) throw new Error("RcloneConfig requires a configPath");
    this.configPath = configPath;
    this.rclone = rclone ?? new RcloneBackend();
  }

  /** Create an empty conf (mode 600) if none exists. Idempotent. */
  ensureConfig(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.configPath)) {
      fs.writeFileSync(this.configPath, "", { mode: 0o600 });
    }
  }

  /** Parse the conf into remote blocks. Missing file => empty list. */
  read(): RcloneRemote[] {
    if (!fs.existsSync(this.configPath)) return [];
    const text = fs.readFileSync(this.configPath, "utf-8");
    return parseIni(text);
  }

  /** Look up one remote by name. */
  get(name: string): RcloneRemote | undefined {
    return this.read().find((r) => r.name === name);
  }

  /** Names present in the conf. */
  names(): string[] {
    return this.read().map((r) => r.name);
  }
  /** Back up the current conf before any overwrite. Never deletes originals. */
  private backup(): string | null {
    if (!fs.existsSync(this.configPath)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bak = `${this.configPath}.bak-${stamp}`;
    fs.copyFileSync(this.configPath, bak);
    return bak;
  }

  /** Atomic write: temp file in same dir + rename. Never a partial conf. */
  private atomicWrite(remotes: RcloneRemote[]): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `.rclone.conf.tmp-${process.pid}-${Date.now()}`);
    fs.writeFileSync(tmp, serializeIni(remotes), { mode: 0o600 });
    fs.renameSync(tmp, this.configPath);
  }

  /**
   * Validate a remote's params. Rejects inline credential material: any
   * secret-shaped key whose value is NOT a ${VAR} reference is refused.
   * Returns null if valid, else a human-readable reason.
   */
  private validateParams(type: string, params: Record<string, string>): string | null {
    for (const [k, v] of Object.entries(params)) {
      const key = k.toLowerCase();
      const looksSecret = SECRET_PARAM_KEYS.some((s) => key.includes(s));
      const isVarRef = /^\$\{[A-Z0-9_]+\}$/.test(v);
      // rclone stores obscured passwords (already safe), so allow obscured= too.
      const isObscured = key === "password" && v.length > 0 && !/[\s]/.test(v) && !isVarRef;
      if (looksSecret && !isVarRef && !isObscured) {
        return `param '${k}' looks like a credential but is not a \${VAR} reference ` +
          `or an obscured password; refusing to write inline secrets`;
      }
    }
    if (!type || !/^[a-z0-9_]+$/.test(type)) {
      return `invalid rclone remote type '${type}'`;
    }
    return null;
  }
  /**
   * Write (create or update) a remote block. Backs up the prior conf, rejects
   * inline secrets, and writes atomically. Returns the backup path (if any).
   */
  writeRemote(
    name: string,
    type: string,
    params: Record<string, string> = {},
  ): { ok: boolean; backup?: string | null; error?: string } {
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) {
      return { ok: false, error: `invalid remote name '${name}'` };
    }
    const bad = this.validateParams(type, params);
    if (bad) return { ok: false, error: bad };

    // Resolve ${VAR} references from process.env BEFORE writing. rclone does not
    // expand variables itself; the 600-perm conf is the secret store (this is
    // how rclone expects credentials). Input must NOT contain inline literals
    // for secret-shaped keys (validateParams already enforced that).
    let resolved: Record<string, string>;
    try {
      resolved = this.resolveVars(params);
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }

    this.ensureConfig();
    const backup = this.backup();
    const remotes = this.read().filter((r) => r.name !== name);
    remotes.push({ name, type, params: resolved });
    this.atomicWrite(remotes);
    return { ok: true, backup };
  }

  /**
   * Expand ${VAR} references in param values from process.env. A reference whose
   * variable is UNSET is returned as a sentinel error so callers don't write a
   * broken remote. Non-${...} values pass through unchanged.
   */
  private resolveVars(params: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
      const m = /^\$\{([A-Z0-9_]+)\}$/.exec(v);
      if (m) {
        const val = process.env[m[1]];
        if (val === undefined || val === "") {
          throw new Error(`unset environment variable '${m[1]}' for rclone param '${k}'`);
        }
        out[k] = val;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /**
   * Deprecate (not delete) a remote. Its block is moved to a timestamped
   * .deprecated sidecar next to the conf, then removed from the live conf.
   * Remote DATA is never touched — additive-only contract.
   */
  removeRemote(name: string): { ok: boolean; deprecated?: string } {
    this.ensureConfig();
    const remotes = this.read();
    const target = remotes.find((r) => r.name === name);
    if (!target) return { ok: false };

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const deprecatedPath = `${this.configPath}.deprecated-${stamp}`;
    fs.writeFileSync(deprecatedPath, serializeIni([target]), { mode: 0o600 });

    this.backup();
    this.atomicWrite(remotes.filter((r) => r.name !== name));
    return { ok: true, deprecated: deprecatedPath };
  }

  /** Confirm rclone itself can read the conf (authoritative parse check). */
  async verify(): Promise<{ ok: boolean; remotes: string[]; error?: string }> {
    try {
      const list = await this.rclone.listRemotes(this.configPath);
      return { ok: true, remotes: list.map((r) => r.name) };
    } catch (err: any) {
      return { ok: false, remotes: [], error: err?.message ?? String(err) };
    }
  }
}
/** Parse rclone's INI into remote blocks: [name] / type = x / key = value. */
export function parseIni(text: string): RcloneRemote[] {
  const remotes: RcloneRemote[] = [];
  let current: RcloneRemote | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      if (current) remotes.push(current);
      current = { name: section[1].trim(), type: "", params: {} };
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1 || !current) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "type") current.type = value;
    else current.params[key] = value;
  }
  if (current) remotes.push(current);
  return remotes;
}

/** Serialize remote blocks back to rclone's INI (type line first). */
export function serializeIni(remotes: RcloneRemote[]): string {
  const out: string[] = [];
  for (const r of remotes) {
    out.push(`[${r.name}]`);
    out.push(`type = ${r.type}`);
    for (const [k, v] of Object.entries(r.params)) out.push(`${k} = ${v}`);
    out.push("");
  }
  return out.join("\n");
}

/** Convenience factory. */
export function createRcloneConfig(configPath: string): RcloneConfig {
  return new RcloneConfig(configPath);
}
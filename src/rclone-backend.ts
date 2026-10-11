// EME Storage Router — Phase 2b: RcloneBackend
// Wraps the `rclone` binary for the storage router. Shells out to rclone for
// copy / check / crypt / pool operations. ADDITIVE ONLY: we always invoke
// `copy` (or `copyto`), NEVER bare `sync`, so router writes can never delete
// remote data. See .tasks/002-rclone-router-core.md Phase 1.
//
// Rules honored here:
// - Detect the binary; throw a clear, actionable error if absent.
// - Tuned for low-end hardware (--transfers 2 --checkers 4 by default).
// - Structured result objects; no throwing on non-zero unless caller opts in.
// - NEVER log secret material (crypt passwords).

import { spawn } from "child_process";

export interface RcloneResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  command: string;
}

export interface RcloneCopyOptions {
  /** rclone --transfers (default 2, low-end friendly) */
  transfers?: number;
  /** rclone --checkers (default 4) */
  checkers?: number;
  /** Extra raw flags appended verbatim (advanced callers only). */
  extraArgs?: string[];
  /** Bandwidth limit, e.g. "10M". Omitted = unlimited. */
  bwlimit?: string;
}

export interface RcloneRemoteInfo {
  name: string;
  type: string;
}

export interface RcloneAbout {
  ok: boolean;
  freeBytes?: number;
  totalBytes?: number;
  usedBytes?: number;
  error?: string;
}

/**
 * Thin, typed wrapper over the rclone CLI. One instance is reusable; it lazily
 * resolves the binary path once and caches it.
 */
export class RcloneBackend {
  private binary: string;
  private resolved = false;
  /** Optional EME-managed rclone.conf path applied to every invocation. */
  readonly configPath?: string;

  constructor(binary = "rclone", configPath?: string) {
    this.binary = binary;
    this.configPath = configPath;
  }

  /** Args to pin every rclone call to the EME-managed config, if set. */
  private baseArgs(): string[] {
    return this.configPath ? ["--config", this.configPath] : [];
  }

  /**
   * Return a backend pinned to a config path. If this backend already has a
   * config path (or none is requested), returns itself. Lets callers inject a
   * bare backend and still have the EME-managed conf honored.
   */
  withConfig(configPath?: string): RcloneBackend {
    if (!configPath || this.configPath) return this;
    return new RcloneBackend(this.binary, configPath);
  }

  /**
   * Resolve the rclone binary location. Throws an actionable error if absent.
   * Idempotent — caches the resolved path.
   */
  async ensureBinary(): Promise<string> {
    if (this.resolved) return this.binary;
    const which = await this.execRaw("which", [this.binary]);
    if (!which.ok || !which.stdout.trim()) {
      throw new Error(
        `rclone binary not found (tried '${this.binary}'). ` +
          `Install it (e.g. 'sudo apt install rclone' or https://rclone.org/install/) ` +
          `and ensure it is on PATH.`,
      );
    }
    this.binary = which.stdout.trim();
    this.resolved = true;
    return this.binary;
  }

  /** Spawn an arbitrary binary with args and capture output. Low-level. */
  private execRaw(
    bin: string,
    args: string[],
    opts: { timeoutMs?: number } = {},
  ): Promise<RcloneResult> {
    return new Promise((resolve) => {
      const command = `${bin} ${args.join(" ")}`;
      let stdout = "";
      let stderr = "";
      let settled = false;

      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

      const timeoutMs = opts.timeoutMs ?? 120000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({
          ok: false,
          code: null,
          stdout,
          stderr: stderr + `\n[timeout after ${timeoutMs}ms]`,
          command,
        });
      }, timeoutMs);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          code: null,
          stdout,
          stderr: stderr + `\n${err.message}`,
          command,
        });
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, code, stdout, stderr, command });
      });
    });
  }

  /** Run an rclone subcommand (after the binary has been resolved).
   *  If a configPath is set, `--config <path>` is appended to EVERY call so
   *  the EME-managed conf is always authoritative. Callers that already pass
   *  their own --config are expected to have omitted the instance config. */
  async run(args: string[], timeoutMs = 120000): Promise<RcloneResult> {
    const bin = await this.ensureBinary();
    const hasConfigFlag = args.includes("--config");
    const fullArgs = hasConfigFlag ? args : [...args, ...this.baseArgs()];
    return this.execRaw(bin, fullArgs, { timeoutMs });
  }

  /**
   * ADDITIVE copy. Uses `rclone copy` (never `sync`). Both src and dst are
   * rclone remote:path strings (or plain local paths).
   */
  async copy(
    src: string,
    dst: string,
    opts: RcloneCopyOptions = {},
  ): Promise<RcloneResult> {
    const args = ["copy", src, dst];
    args.push("--transfers", String(opts.transfers ?? 2));
    args.push("--checkers", String(opts.checkers ?? 4));
    if (opts.bwlimit) args.push("--bwlimit", opts.bwlimit);
    if (opts.extraArgs?.length) args.push(...opts.extraArgs);
    return this.run(args);
  }

  /**
   * Compare src and dst by hash. Returns ok=false on any difference, which the
   * router surfaces as a verification failure (copy-never-lies semantics).
   */
  async check(src: string, dst: string): Promise<RcloneResult> {
    return this.run(["check", src, dst, "--one-way"]);
  }

  /** List configured remotes from the EME-managed rclone.conf. */
  async listRemotes(rcloneConfigPath?: string): Promise<RcloneRemoteInfo[]> {
    const args = ["listremotes"];
    if (rcloneConfigPath) args.push("--config", rcloneConfigPath);
    const res = await this.run(args);
    if (!res.ok) return [];
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((name) => ({ name, type: "unknown" }));
  }

  /**
   * Query free/total/used bytes for a remote (health signal). `about` is not
   * supported by every backend; failures degrade gracefully to ok:false.
   */
  async about(remote: string, rcloneConfigPath?: string): Promise<RcloneAbout> {
    const args = ["about", remote, "--json"];
    if (rcloneConfigPath) args.push("--config", rcloneConfigPath);
    const res = await this.run(args);
    if (!res.ok) {
      return { ok: false, error: (res.stderr || res.stdout).trim() };
    }
    try {
      const j = JSON.parse(res.stdout);
      return {
        ok: true,
        freeBytes: j.free,
        totalBytes: j.total,
        usedBytes: j.used,
      };
    } catch {
      return { ok: false, error: "could not parse rclone about JSON" };
    }
  }

  /**
   * Create a crypt remote over an existing remote. The password/obscured form is
   * passed directly to rclone's `config create`; it is NEVER logged here.
   * For Phase 3 (secrets). Returns the obscured password on success.
   */
  async cryptRemoteSetup(
    name: string,
    remote: string,
    password: string,
    salt = "",
    rcloneConfigPath?: string,
  ): Promise<{ ok: boolean; obscured?: string; error?: string }> {
    // `rclone config create <name> crypt remote=<remote> password=<pw> [salt=<s>]`
    // Password must be obscured for rclone; use `rclone obscure` first.
    const obscureArgs = ["obscure", password];
    if (rcloneConfigPath) obscureArgs.push("--config", rcloneConfigPath);
    const obscuredRes = await this.run(obscureArgs);
    if (!obscuredRes.ok) {
      // Do NOT include the password in the error.
      return { ok: false, error: "rclone obscure failed" };
    }
    const obscured = obscuredRes.stdout.trim();

    const args = [
      "config",
      "create",
      name,
      "crypt",
      `remote=${remote}`,
      `password=${obscured}`,
    ];
    if (salt) args.push(`salt=${salt}`);
    if (rcloneConfigPath) args.push("--config", rcloneConfigPath);

    const res = await this.run(args);
    return res.ok
      ? { ok: true, obscured }
      : { ok: false, error: (res.stderr || res.stdout).trim() };
  }

  /** Plain text dump of a remote's config (for reconciliation/tests only). */
  async configDump(
    name: string,
    rcloneConfigPath?: string,
  ): Promise<RcloneResult> {
    const args = ["config", "dump", name];
    if (rcloneConfigPath) args.push("--config", rcloneConfigPath);
    return this.run(args);
  }
}

/** Convenience singleton factory — callers may also `new RcloneBackend()`. */
export function createRcloneBackend(binary = "rclone"): RcloneBackend {
  return new RcloneBackend(binary);
}

// EME Storage Router — Phase 2b: EME-managed rclone.conf writer tests.
// Proves the §8.3 deliverable: atomic writes, backup-on-overwrite,
// credential rejection, deprecate-never-delete, and INI round-trip.
//
// Run: npx jest tests/rclone-config.test.ts --runInBand
// Uses a REAL rclone binary for the verify() check; skips gracefully if absent.

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { RcloneConfig, parseIni, serializeIni } from "../src/rclone-config.js";

let dir: string;
let confPath: string;
let conf: RcloneConfig;
let hasRclone = true;

beforeAll(() => {
  try { execFileSync("rclone", ["version"], { stdio: "ignore" }); }
  catch { hasRclone = false; }
});

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eme-rclone-conf-"));
  confPath = path.join(dir, "rclone.conf");
  conf = new RcloneConfig(confPath);
});
describe("RcloneConfig.ensureConfig", () => {
  test("creates an empty conf (mode 600) when absent", () => {
    expect(fs.existsSync(confPath)).toBe(false);
    conf.ensureConfig();
    expect(fs.existsSync(confPath)).toBe(true);
    const mode = fs.statSync(confPath).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(conf.read()).toEqual([]);
  });

  test("is idempotent — does not clobber an existing conf", () => {
    conf.ensureConfig();
    conf.writeRemote("mega1", "mega", { user: "a@b.c" });
    conf.ensureConfig();
    expect(conf.names()).toContain("mega1");
  });
});

describe("RcloneConfig.writeRemote", () => {
  test("writes a remote block readable back via parse", () => {
    const r = conf.writeRemote("localtest", "local", {});
    expect(r.ok).toBe(true);
    expect(conf.names()).toEqual(["localtest"]);
    const remote = conf.get("localtest");
    expect(remote?.type).toBe("local");
  });

  test("accepts a \${VAR} reference for a secret-shaped param", () => {
    const r = conf.writeRemote("s3", "s3", {
      provider: "Other",
      access_key_id: "\${FILEBASE_ACCESS_KEY}",
      secret_access_key: "\${FILEBASE_SECRET_KEY}",
    });
    expect(r.ok).toBe(true);
    expect(conf.get("s3")?.params.access_key_id).toBe("\${FILEBASE_ACCESS_KEY}");
  });
  test("REJECTS an inline secret literal (no \${VAR}, not obscured)", () => {
    const r = conf.writeRemote("bad", "s3", { secret_access_key: "AKIALITERALSECRET123" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/credential|secret/i);
    expect(fs.existsSync(confPath)).toBe(false); // nothing written
  });
});

describe("RcloneConfig backup + atomicity", () => {
  test("backs up the prior conf before overwrite (never deletes)", () => {
    conf.writeRemote("first", "local", {});
    const r = conf.writeRemote("second", "local", {});
    expect(r.ok).toBe(true);
    expect(r.backup).toBeTruthy();
    expect(fs.existsSync(r.backup!)).toBe(true);
    // both remotes present, original backup intact
    expect(conf.names().sort()).toEqual(["first", "second"]);
  });

  test("leaves no temp file behind after a write", () => {
    conf.writeRemote("x", "local", {});
    const stray = fs.readdirSync(dir).filter((f) => f.includes(".tmp-"));
    expect(stray).toEqual([]);
  });
});

describe("RcloneConfig.removeRemote (deprecate, never delete)", () => {
  test("moves the block to a .deprecated sidecar", () => {
    conf.writeRemote("gone", "local", {});
    const r = conf.removeRemote("gone");
    expect(r.ok).toBe(true);
    expect(r.deprecated).toBeTruthy();
    expect(fs.existsSync(r.deprecated!)).toBe(true);
    expect(conf.names()).not.toContain("gone");
  });

  test("returns ok=false for an unknown remote", () => {
    expect(conf.removeRemote("nope").ok).toBe(false);
  });
});

describe("INI round-trip", () => {
  test("serialize -> parse preserves remotes", () => {
    const remotes = [{ name: "a", type: "local", params: {} }, { name: "b", type: "s3", params: { provider: "Other" } }];
    expect(parseIni(serializeIni(remotes))).toEqual(remotes);
  });
});

describe("RcloneConfig.verify (rclone binary)", () => {
  test("rclone listremotes reads the authored conf", async () => {
    if (!hasRclone) { console.warn("rclone not present, skipping"); return; }
    conf.writeRemote("localtest", "local", {});
    const v = await conf.verify();
    expect(v.ok).toBe(true);
    expect(v.remotes).toContain("localtest:");
  });
});
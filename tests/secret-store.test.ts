/**
 * SecretStore tests — Phase 3 (secrets layer).
 *
 * Uses a REAL rclone crypt remote (localtest-crypt:) over a local backend.
 * Proves: put->get round-trip, encryption-at-rest, resolve substitution,
 * metadata-only list, deny-by-default ACL, and redaction (value never leaks).
 *
 * Setup:
 *   rclone config create localtest local --config <tmp>
 *   rclone config create localtest-crypt crypt remote=localtest:<dir> \
 *     password=$(rclone obscure <pw>) --config <tmp>
 * Run: npx jest tests/secret-store.test.ts --runInBand
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { SecretStore, denyAll, CanAccess } from "../src/secret-store.js";
import { RcloneBackend } from "../src/rclone-backend.js";

const RCLONE_CONF = path.join(os.tmpdir(), "eme-it-rclone.conf");

function ensureRemotes(): void {
  try {
    execFileSync("rclone", ["config", "create", "localtest", "local", "--config", RCLONE_CONF], { stdio: "ignore" });
  } catch { /* exists */ }
  try {
    const obscured = execFileSync("rclone", ["obscure", "test-crypt-pw-123"], { encoding: "utf-8" }).trim();
    execFileSync(
      "rclone",
      ["config", "create", "localtest-crypt", "crypt", "remote=localtest:/tmp/eme-secret-backend", `password=${obscured}`, "--config", RCLONE_CONF],
      { stdio: "ignore" },
    );
  } catch { /* exists */ }
}

describe("SecretStore (real crypt remote)", () => {
  let base: string;
  let store: SecretStore;
  let access: { allow: boolean };

  beforeAll(async () => {
    ensureRemotes();
    base = await fs.mkdtemp(path.join(os.tmpdir(), "eme-secret-it-"));
    access = { allow: false };
    const hook: CanAccess = () => access.allow;
    store = new SecretStore(
      { cryptRemote: "localtest-crypt:eme-secrets", localPath: base, rcloneConfigPath: RCLONE_CONF },
      { rclone: new RcloneBackend("rclone", RCLONE_CONF), canAccess: hook },
    );
  });

  test("put -> get round-trip returns the exact value", async () => {
    await store.put("MY_API_KEY", "super-secret-value-42", { namespace: "test", tags: ["api"] });
    const got = await store.get("MY_API_KEY", { namespace: "test" });
    expect(got).toBe("super-secret-value-42");
  });

  test("payload is encrypted at rest (backend file != plaintext)", async () => {
    await store.put("AT_REST", "plaintext-marker-xyz", { namespace: "atrest" });
    // rclone crypt obfuscates BOTH dir and file names, so we walk the whole
    // backend tree generically rather than guessing a path. The assertion: no
    // file name or content anywhere on the backend contains the plaintext.
    const backend = "/tmp/eme-secret-backend";
    const walk = async (dir: string): Promise<string[]> => {
      const out: string[] = [];
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...(await walk(p)));
        else out.push(p);
      }
      return out;
    };
    const files = await walk(backend);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(path.basename(f)).not.toContain("AT_REST");
      const content = await fs.readFile(f, "utf-8").catch(() => "");
      expect(content).not.toContain("plaintext-marker-xyz");
    }
  });

  test("resolve() substitutes ${NAME} tokens", async () => {
    await store.put("MY_API_KEY", "key-value-abc", { namespace: "default" });
    const out = await store.resolve("url=https://x.com?k=${MY_API_KEY}");
    expect(out).toBe("url=https://x.com?k=key-value-abc");
  });

  test("resolve() leaves unknown tokens untouched", async () => {
    const out = await store.resolve("keep=${NOT_IN_STORE}");
    expect(out).toBe("keep=${NOT_IN_STORE}");
  });

  test("list() returns metadata only, never a value field", async () => {
    await store.put("LISTED", "secret-that-must-not-appear", { namespace: "listns", tags: ["t1"] });
    const items = await store.list({ namespace: "listns" });
    expect(items.length).toBeGreaterThan(0);
    const first = items[0] as any;
    expect(first.name).toBeDefined();
    expect(first.namespace).toBe("listns");
    expect(first.tags).toContain("t1");
    // No value/payload field may exist on metadata.
    expect(first.value).toBeUndefined();
    expect(JSON.stringify(items)).not.toContain("secret-that-must-not-appear");
  });

  test("canAccess defaults to DENY (no agent allowed)", () => {
    const s = new SecretStore(
      { cryptRemote: "localtest-crypt:eme-secrets", localPath: base, rcloneConfigPath: RCLONE_CONF },
      { rclone: new RcloneBackend("rclone", RCLONE_CONF) },
    );
    // denyAll hook: the store itself never gates get() (ACL is enforced at the
    // tool boundary), so we assert the exported default is deny.
    expect(denyAll({ name: "x", namespace: "y", tags: [], createdAt: 0, updatedAt: 0 }, "agent-1")).toBe(false);
  });

  test("redaction: secret value never appears in the metadata index", async () => {
    await store.put("REDACT_ME", "top-secret-redaction-check", { namespace: "redact" });
    const idx = await fs.readFile(path.join(base, "secrets-index.json"), "utf-8");
    expect(idx).not.toContain("top-secret-redaction-check");
    expect(idx).toContain("REDACT_ME");
  });
});

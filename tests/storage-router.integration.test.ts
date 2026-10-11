/**
 * Storage Router integration test — Phase 2b.
 *
 * Uses a REAL `local:` rclone remote (created by the test if missing) to prove
 * end-to-end: route an archive write -> file exists at destination -> check
 * hash match -> additive copy restores a deleted dest file.
 *
 * Setup: rclone config create localtest local --config <tmp>
 * Run:   npx jest tests/storage-router.integration.test.ts --runInBand
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { Config } from "../src/types.js";
import { StorageRouter } from "../src/storage-router.js";
import { RcloneBackend } from "../src/rclone-backend.js";

const RCLONE_CONF = path.join(os.tmpdir(), "eme-it-rclone.conf");

function ensureLocalRemote(): void {
  try {
    execFileSync("rclone", ["config", "create", "localtest", "local", "--config", RCLONE_CONF], { stdio: "ignore" });
  } catch {
    /* already exists or rclone absent — test will fail clearly below */
  }
}

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("StorageRouter integration (real local: remote)", () => {
  let base: string;
  let router: StorageRouter;

  beforeAll(async () => {
    ensureLocalRemote();
    base = await tmpDir("eme-router-it-");
    const destRoot = path.join(base, "remote");
    await fs.mkdir(destRoot, { recursive: true });

    const cfg: Config = {
      destinations: [
        {
          id: "mega-pool",
          kind: "rclone",
          role: "archive",
          remote: `localtest:${destRoot}`,
          health: { ok: true },
          config: {},
        },
      ],
      routing: [
        { id: "archive", match: { dataClass: "archive" }, primary: "mega-pool", verify: "hash", encrypt: false },
      ],
      rcloneConfigPath: RCLONE_CONF,
    } as Config;

    router = new StorageRouter(cfg, { rclone: new RcloneBackend() });
  });

  test("routes an archive write and the file lands at the destination", async () => {
    const srcDir = await tmpDir("eme-src-");
    const srcFile = path.join(srcDir, "memory.json");
    await fs.writeFile(srcFile, JSON.stringify({ id: "m1", text: "hello" }));

    const res = await router.routeWrite({ dataClass: "archive", key: "m1" }, srcFile);
    expect(res.copied).toBe(true);
    expect(res.verified).toBe(true); // verify=hash for archive

    // rclone copy flattens into the remote dir; the file must exist there.
    const remoteDir = router.dryRun({ dataClass: "archive" }).primary.remote!;
    const remoteFsPath = remoteDir.replace(/^localtest:/, "");
    const landed = path.join(remoteFsPath, "memory.json");
    const stat = await fs.stat(landed);
    expect(stat.isFile()).toBe(true);
  });

  test("additive copy restores a deleted destination file", async () => {
    const srcDir = await tmpDir("eme-src2-");
    const srcFile = path.join(srcDir, "restore.json");
    await fs.writeFile(srcFile, JSON.stringify({ id: "m2" }));

    const remoteDir = router.dryRun({ dataClass: "archive" }).primary.remote!;
    const remoteFsPath = remoteDir.replace(/^localtest:/, "");
    const landed = path.join(remoteFsPath, "restore.json");

    await router.routeWrite({ dataClass: "archive" }, srcFile);
    await fs.unlink(landed); // simulate loss
    await expect(fs.stat(landed)).rejects.toThrow();

    // Re-run: additive copy must bring it back (never deletes).
    const res = await router.routeWrite({ dataClass: "archive" }, srcFile);
    expect(res.copied).toBe(true);
    const stat = await fs.stat(landed);
    expect(stat.isFile()).toBe(true);
  });

  test("testDestination probes health via rclone about (graceful)", async () => {
    const health = await router.testDestination("mega-pool");
    // local: may or may not support `about`; we only assert it returns a shape.
    expect(typeof health.ok).toBe("boolean");
  });
});

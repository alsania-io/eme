// EME Storage Router — Phase 2b: destination_add persistence + rclone.conf write.
// Proves §2 (destinations survive restart) and §8.3 (remote authored into the
// EME-managed conf) end-to-end through the registrar dispatch seam.

import fs from "fs";
import os from "os";
import path from "path";
import { StorageRouter } from "../src/storage-router.js";
import { RcloneConfig } from "../src/rclone-config.js";
import { dispatchRouterTool } from "../src/router-tools.js";
import { Config, Destination } from "../src/types.js";
import { saveConfig, loadConfig } from "../src/config-loader.js";

let dir: string;
let confPath: string;
let configPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eme-router-persist-"));
  confPath = path.join(dir, "storage", "rclone.conf");
  configPath = path.join(dir, "eme-config.json");
});

function baseConfig(): Config {
  // Seed an isolated on-disk config so loadConfig() resolves OUR file, never
  // the repo's storage/eme-config.json (candidate discovery walks cwd).
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ vectorStore: "memory", graphStore: "memory", snapshotStore: "filesystem", openRouterApiKey: "${OPENROUTERAPIKEY}", destinations: [], routing: [] }, null, 2));
  const c = loadConfig(configPath);
  c.vectorStore = "memory";
  c.graphStore = "memory";
  c.snapshotStore = "filesystem";
  c.snapshotPath = path.join(dir, "snaps");
  c.rcloneConfigPath = confPath;
  c.destinations = [];
  c.routing = [];
  return c;
}
describe("destination_add persistence", () => {
  test("persists the destination list to config.json", async () => {
    const config = baseConfig();
    const router = new StorageRouter(config);
    const rcloneConfig = new RcloneConfig(confPath);

    const res = await dispatchRouterTool(
      "destination_add",
      { id: "localtest", kind: "rclone", role: "archive", remote: "localtest:", config: { rcloneType: "local" } },
      router,
      { rcloneConfig, persist: (dests: Destination[]) => { config.destinations = dests; return saveConfig(config, configPath); } },
    );

    const payload = JSON.parse((res!.content[0] as any).text);
    expect(payload.added).toBe("localtest");
    expect(payload.persisted.ok).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    // Reload from disk — the destination survives a restart.
    const reloaded = loadConfig(configPath);
    expect(reloaded.destinations?.map((d) => d.id)).toContain("localtest");
  });

  test("writes the rclone remote into the EME-managed conf", async () => {
    const config = baseConfig();
    const router = new StorageRouter(config);
    const rcloneConfig = new RcloneConfig(confPath);

    await dispatchRouterTool(
      "destination_add",
      { id: "pool", kind: "rclone", role: "archive", remotes: ["mega1:", "mega2:"], config: { rcloneType: "mega" } },
      router,
      { rcloneConfig, persist: (dests: Destination[]) => { config.destinations = dests; return saveConfig(config, configPath); } },
    );

    const names = rcloneConfig.names();
    expect(names).toContain("mega1");
    expect(names).toContain("mega2");
  });

  test("destination_remove persists the post-removal list", async () => {
    const config = baseConfig();
    const router = new StorageRouter(config);
    const rcloneConfig = new RcloneConfig(confPath);
    const deps = { rcloneConfig, persist: (dests: Destination[]) => { config.destinations = dests; return saveConfig(config, configPath); } };

    await dispatchRouterTool("destination_add", { id: "a", kind: "local", role: "archive", path: "/tmp" }, router, deps);
    await dispatchRouterTool("destination_remove", { id: "a" }, router, deps);

    const reloaded = loadConfig(configPath);
    expect(reloaded.destinations?.map((d) => d.id)).not.toContain("a");
  });
});
describe("saveConfig secret safety (regression)", () => {
  test("never persists an env-resolved secret back to disk", () => {
    // Seed a config whose secret is a ${VAR} placeholder.
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ openRouterApiKey: "${OPENROUTERAPIKEY}", destinations: [], routing: [] }, null, 2));

    // Simulate loadConfig having RESOLVED the secret in memory.
    const c = loadConfig(configPath);
    (c as any).openRouterApiKey = "sk-or-v1-REALSECRETMUSTNOTLEAK";
    c.destinations = [{ id: "x", kind: "local", role: "archive", health: { ok: false }, config: {} } as Destination];

    const r = saveConfig(c, configPath);
    expect(r.ok).toBe(true);

    const disk = fs.readFileSync(configPath, "utf-8");
    expect(disk).not.toContain("REALSECRETMUSTNOTLEAK");
    expect(disk).toContain("${OPENROUTERAPIKEY}"); // placeholder preserved
    expect(disk).toContain("\"x\""); // router patch applied
  });
});
// Provision the Filebase destinations into EME (Storage Router Phase 2c).
// Loads FILEBASE_* from .env, writes the filebase-s3 rclone remote (creds
// resolved into the 600-perm conf), registers destinations, and tests live.
//
// Run: node scripts/provision-filebase.mjs

import "dotenv/config";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const ROOT = process.cwd();
const CONF = path.join(ROOT, "storage", "rclone.conf");
const CONFIG = fs.existsSync(path.join(ROOT, "eme-config.json"))
  ? path.join(ROOT, "eme-config.json")
  : path.join(ROOT, "storage", "eme-config.json");

const AK = process.env.FILEBASE_ACCESS_KEY;
const SK = process.env.FILEBASE_SECRET_KEY;
if (!AK || !SK) {
  console.error("Missing FILEBASE_ACCESS_KEY / FILEBASE_SECRET_KEY in .env");
  process.exit(1);
}

// 1. Write the filebase-s3 remote into the EME-managed conf (via rclone config create,
//    which obscures secrets correctly).
fs.mkdirSync(path.dirname(CONF), { recursive: true });
function rclone(args) {
  return execFileSync("rclone", [...args, "--config", CONF], { encoding: "utf-8" });
}
try {
  rclone(["config", "delete", "filebase-s3"]);
} catch { /* not present */ }
rclone([
  "config", "create", "filebase-s3", "s3",
  "provider=Other",
  "endpoint=https://s3.filebase.com",
  "region=us-east-1",
  `access_key_id=${AK}`,
  `secret_access_key=${SK}`,
]);
console.log("✅ rclone remote 'filebase-s3' written to", CONF);

// 2. Register destinations in config.json (no credentials inline).
//    Merge into the EXISTING `storageRouter.destinations` block (the established
//    source). Do NOT create a flat `destinations` field — flat wins over the
//    block and would clobber the other destinations (regression caught live).
const cfg = fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, "utf-8")) : {};
// Clean up any flat field a previous run may have created.
delete cfg.destinations;
cfg.storageRouter = cfg.storageRouter ?? {};
const existing = Array.isArray(cfg.storageRouter.destinations) ? cfg.storageRouter.destinations : [];
const merged = existing.filter((d) => !["filebase-s3", "filebase-pin"].includes(d.id));
merged.push(
  { id: "filebase-s3", kind: "rclone", role: "archive", remote: "filebase-s3:", health: { ok: false }, config: { note: "Filebase S3-compatible archive" } },
  { id: "filebase-pin", kind: "ipfs", role: "immutable", health: { ok: false }, config: { note: "Filebase IPFS pinning (CIDs) via ipfs-store; token via ${FILEBASE_IPFS_TOKEN}" } },
);
cfg.storageRouter.destinations = merged;
cfg.storageRouter.rcloneConfigPath = cfg.storageRouter.rcloneConfigPath ?? "./storage/rclone.conf";
fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
console.log(`✅ destinations registered (${merged.length} total) in`, CONFIG);

// 3. Test connectivity (list the bucket root / about).
try {
  const out = execFileSync("rclone", ["lsd", "filebase-s3:", "--config", CONF, "--max-depth", "1"], { encoding: "utf-8", timeout: 30000 });
  console.log("✅ filebase-s3 reachable. Buckets:\n" + (out || "(none yet)"));
} catch (err) {
  console.error("⚠️ filebase-s3 probe failed:", err.message.split("\n")[0]);
  process.exit(2);
}

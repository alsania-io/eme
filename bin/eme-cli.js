#!/usr/bin/env node
import { apiKeyManager } from "../dist/api-keys.js";
const ADMIN_KEY = process.env.EME_ADMIN_KEY;
async function loadKeys() { await apiKeyManager.load(); }
async function generateKey(name, owner, tier = "free", expiresDays) {
  const expiresAt = expiresDays ? Date.now() + (expiresDays * 24 * 60 * 60 * 1000) : null;
  const { key, apiKey } = await apiKeyManager.createKey(name, owner, tier, expiresAt);
  console.log(`\n✅ API Key Generated\n   Key: ${key}\n   ID: ${apiKey.id}\n   Name: ${name}\n   Owner: ${owner}\n   Tier: ${tier}\n`);
  await apiKeyManager.persist();
}
async function listKeys(owner) {
  const keys = await apiKeyManager.listKeys(owner);
  console.log(`\n📋 API Keys (${keys.length} total)\n`);
  for (const key of keys) console.log(`   ${key.id.substring(0,8)}... | ${key.name.padEnd(20)} | ${key.tier.padEnd(10)} | ${key.enabled ? "✅" : "❌"}`);
  console.log();
}
async function revokeKey(keyOrId) {
  const success = await apiKeyManager.revokeKey(keyOrId);
  console.log(success ? "\n✅ Key revoked\n" : "\n❌ Key not found\n");
  await apiKeyManager.persist();
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!ADMIN_KEY) { console.error("❌ EME_ADMIN_KEY not set"); process.exit(1); }
  await loadKeys();
  if (command === "generate") {
    const nameIdx = args.indexOf("--name"), ownerIdx = args.indexOf("--owner"), tierIdx = args.indexOf("--tier"), expIdx = args.indexOf("--expires-days");
    if (nameIdx === -1 || ownerIdx === -1) { console.error("Usage: generate --name <name> --owner <email> [--tier tier]"); process.exit(1); }
    await generateKey(args[nameIdx+1], args[ownerIdx+1], tierIdx !== -1 ? args[tierIdx+1] : "free", expIdx !== -1 ? parseInt(args[expIdx+1]) : undefined);
  } else if (command === "list") await listKeys(args[1]);
  else if (command === "revoke") {
    const keyIdx = args.indexOf("--key");
    if (keyIdx === -1) { console.error("Usage: revoke --key <key-or-id>"); process.exit(1); }
    await revokeKey(args[keyIdx+1]);
  } else console.log(`Commands: generate, list, revoke`);
}
main().catch(console.error);

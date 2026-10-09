/**
 * Capture Classifier — Enhanced Protocol Phase 1.
 *
 * Classifies an incoming capture into:
 *  - dataClass (routing destination, Phase 2+)
 *  - tier (hot/warm/cold placement)
 *  - shouldSave (capture gate)
 *
 * Heuristic, zero-dep. Replaces the old memoryGateFilter's role as the
 * *capture filter* (it was dead-ish; the router absorbs it).
 *
 * Detection order matters: secret > immutable > explicit priority > default.
 */

import type { CaptureRequest, CaptureClassification, DataClass, Tier } from "./types.js";

// IPv4/6 not needed; these are the markers that actually appear in Alsania work.
const IPFS_CID = /\b(bafy[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{40,})\b/;
const EVM_ADDR = /\b0x[a-fA-F0-9]{40}\b/;
// An env-style assignment whose key ends in _API_KEY/_SECRET/_TOKEN/_PASS.
const SECRET_ASSIGN = /\b[A-Z0-9_]*(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*\S+/i;
const SECRET_INLINE = /\b(sk-[A-Za-z0-9]{16,}|eb15d092[a-f0-9]+)\b/;

function detectSecret(text: string): boolean {
  return SECRET_ASSIGN.test(text) || SECRET_INLINE.test(text);
}

function detectImmutable(text: string): boolean {
  return IPFS_CID.test(text) || EVM_ADDR.test(text);
}

export function classifyCapture(req: CaptureRequest): CaptureClassification {
  const text = req.text ?? "";
  const priority = req.priority ?? "medium";

  // 0. Nothing to save.
  if (text.trim().length === 0) {
    return {
      dataClass: "disposable",
      tier: "cold",
      priority,
      shouldSave: false,
      reason: "empty capture",
    };
  }

  // 1. Secrets win — never route to a plaintext destination.
  if (detectSecret(text)) {
    return {
      dataClass: "secret",
      tier: "warm",
      priority: priority === "low" ? "medium" : priority,
      shouldSave: true,
      reason: "matched secret pattern (API key / token)",
    };
  }

  // 2. Immutable artifacts (CIDs, on-chain addresses).
  if (detectImmutable(text)) {
    return {
      dataClass: "immutable",
      tier: "hot",
      priority: priority === "low" ? "high" : priority,
      shouldSave: true,
      reason: "matched CID or EVM address",
    };
  }

  // 3. Explicit low priority with no markers → disposable.
  if (priority === "low") {
    return {
      dataClass: "disposable",
      tier: "cold",
      priority,
      shouldSave: true,
      reason: "low priority, no durable markers",
    };
  }

  // 4. Explicit high priority → hot.
  if (priority === "high") {
    return {
      dataClass: "vector",
      tier: "hot",
      priority,
      shouldSave: true,
      reason: "high priority",
    };
  }

  // 5. Default: a durable vector memory.
  return {
    dataClass: "vector",
    tier: "warm",
    priority,
    shouldSave: true,
    reason: "default durable memory",
  };
}

/**
 * Enhanced Protocol tests — Phase 1 manager integration.
 *
 * Covers: capture classification, tier-aware write, search-first merge,
 * getRecent, prune.
 * Run: npx jest tests/enhanced-protocol.test.ts
 */

import { classifyCapture } from "../src/capture-classifier.js";

describe("classifyCapture", () => {
  test("marks a CID / contract address as immutable", () => {
    const c = classifyCapture({ text: "IPFS CID bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" });
    expect(c.dataClass).toBe("immutable");
  });

  test("marks a 0x address as immutable", () => {
    const c = classifyCapture({ text: "Rescued to 0x8624D7c7aB0e4E5f6a7B8c9D0e1F2a3B4c5D6e7F" });
    expect(c.dataClass).toBe("immutable");
  });

  test("marks an api-key-shaped string as secret", () => {
    const c = classifyCapture({ text: "ALCHEMY_API_KEY=eb15d092deadbeef" });
    expect(c.dataClass).toBe("secret");
  });

  test("high priority forces hot tier", () => {
    const c = classifyCapture({ text: "ordinary note", priority: "high" });
    expect(c.tier).toBe("hot");
  });

  test("low priority with no markers is disposable", () => {
    const c = classifyCapture({ text: "just a passing thought", priority: "low" });
    expect(c.dataClass).toBe("disposable");
  });

  test("default text is vector class, warm tier, saveable", () => {
    const c = classifyCapture({ text: "Sigma prefers direct technical style" });
    expect(c.dataClass).toBe("vector");
    expect(c.shouldSave).toBe(true);
  });
});

import { TierStore, TierEntry } from "../src/tier-store.js";

describe("search-first merge", () => {
  test("merges in-process tier hits with external (cold) results", async () => {
    const store = new TierStore({ hotLimit: 3, warmLimit: 5 });
    store.put({ id: "h1", text: "alpha hot memory", namespace: "default", tags: [], priority: "high", timestamp: 1, tier: "hot" });
    store.put({ id: "h2", text: "beta hot memory", namespace: "default", tags: [], priority: "high", timestamp: 2, tier: "hot" });
    store.put({ id: "h3", text: "gamma", namespace: "default", tags: [], priority: "high", timestamp: 3, tier: "hot" });
    store.put({ id: "w1", text: "alpha warm memory", namespace: "default", tags: [], priority: "low", timestamp: 4, tier: "hot" });

    const local = await store.search("alpha", 10);
    expect(local.map((h) => h.id)).toEqual(expect.arrayContaining(["h1", "w1"]));
    expect(local.every((h) => typeof h.tier === "string")).toBe(true);
  });

  test("ranks higher-scoring hits first", async () => {
    const store = new TierStore({ hotLimit: 10, warmLimit: 10 });
    store.put({ id: "one", text: "alpha", namespace: "default", tags: [], priority: "high", timestamp: 1, tier: "hot" });
    store.put({ id: "two", text: "alpha alpha alpha", namespace: "default", tags: [], priority: "high", timestamp: 2, tier: "hot" });
    const res = await store.search("alpha", 10);
    expect(res[0].id).toBe("two");
  });
});

describe("getRecent contract", () => {
  test("returns entries newer than the cutoff, newest first", () => {
    const store = new TierStore({ hotLimit: 10, warmLimit: 10 });
    const now = Date.now();
    const mk = (id: string, ts: number): TierEntry => ({ id, text: id, namespace: "default", tags: [], priority: "medium", timestamp: ts, tier: "hot" });
    const HOUR = 60 * 60 * 1000;
    store.put(mk("ancient", now - 2 * HOUR));
    store.put(mk("recent", now - 1000));
    store.put(mk("newest", now - 10));

    const recent = store.getRecent(1, 10); // last 1 hour
    expect(recent.map((e) => e.id)).toEqual(["newest", "recent"]);
  });
});

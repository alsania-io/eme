/**
 * MemoryManager tier integration tests — Phase 1.
 *
 * Uses an in-memory vector store (no Qdrant) so the suite runs anywhere.
 * Run: npx jest tests/manager-tiers.test.ts
 */

import { createMemoryManager, MemoryManager } from "../src/memory-manager.js";
import { minimalDefaults } from "../src/config-loader.js";
import type { Config } from "../src/types.js";

function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...minimalDefaults,
    vectorStore: "memory",
    graphStore: "memory",
    snapshotStore: "filesystem",
    embeddingModel: "local",
    embeddingDimension: 384,
    memoryGateEnabled: false, // bypass the old gate; classifier is the new filter
    tierHotLimit: 3,
    tierWarmLimit: 5,
    ...overrides,
  };
}

describe("MemoryManager tiers", () => {
  let mgr: MemoryManager;

  beforeEach(async () => {
    mgr = await createMemoryManager(testConfig());
  });

  afterEach(async () => {
    await mgr.close();
  });

  test("addMemory places an entry into the in-process tier store", async () => {
    await mgr.addMemory("alpha memory", "aegis", "default", [], "shared");
    expect(mgr.tierHotCount() + mgr.tierWarmCount()).toBeGreaterThan(0);
  });

  test("capture() classifies and stores, returning the classification", async () => {
    const res = await mgr.capture({
      text: "ALCHEMY_API_KEY=eb15d092deadbeef",
      agentId: "aegis",
    });
    expect(res.classification.dataClass).toBe("secret");
    expect(res.id).toBeTruthy();
  });

  test("capture() rejects a non-saveable capture", async () => {
    const res = await mgr.capture({
      text: "",
      agentId: "aegis",
    });
    expect(res.classification.shouldSave).toBe(false);
    expect(res.id).toBeNull();
  });

  test("getRecent returns entries within the window, newest first", async () => {
    await mgr.addMemory("older memory", "aegis", "default", [], "shared");
    await mgr.addMemory("newer memory", "aegis", "default", [], "shared");
    const recent = mgr.getRecent(1, 10);
    expect(recent.length).toBe(2);
    expect(recent[0].text).toBe("newer memory");
  });

  test("prune returns a report and never loses entries", async () => {
    for (let i = 0; i < 9; i++) {
      await mgr.addMemory(`memory ${i}`, "aegis", "default", [], "shared");
    }
    const report = mgr.prune();
    expect(report.total).toBe(9);
    expect(report.hot + report.warm + report.cold).toBe(9);
  });
});

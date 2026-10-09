/**
 * MCP verb smoke test — Enhanced Protocol Phase 1.
 *
 * Verifies the new verbs are registered and dispatch to the manager.
 * Run: npx jest tests/mcp-enhanced-verbs.test.ts
 */

import { EMEMCPServer } from "../src/mcp-server.js";
import { minimalDefaults } from "../src/config-loader.js";
import type { Config } from "../src/types.js";

function testConfig(): Config {
  return {
    ...minimalDefaults,
    vectorStore: "memory",
    graphStore: "memory",
    snapshotStore: "filesystem",
    embeddingModel: "local",
    embeddingDimension: 384,
    memoryGateEnabled: false,
    tierHotLimit: 3,
    tierWarmLimit: 5,
  };
}

describe("EMEMCPServer enhanced verbs", () => {
  let server: EMEMCPServer;

  beforeEach(async () => {
    server = new EMEMCPServer(testConfig());
    await server.initialize();
  });

  afterEach(async () => {
    await server.close();
  });

  test("capture dispatches and returns a classification", async () => {
    const res = await server.executeTool("capture", {
      text: "0x8624D7c7aB0e4E5f6a7B8c9D0e1F2a3B4c5D6e7F",
      agentId: "aegis",
    });
    expect(res.classification.dataClass).toBe("immutable");
    expect(res.id).toBeTruthy();
  });

  test("get_recent_memories returns recent entries", async () => {
    await server.executeTool("add_memory", { text: "recent note", agentId: "aegis" });
    const res = await server.executeTool("get_recent_memories", { hours: 1, limit: 10 });
    expect(Array.isArray(res.results)).toBe(true);
    expect(res.results.length).toBeGreaterThan(0);
  });

  test("prune_memories returns a report", async () => {
    const res = await server.executeTool("prune_memories", {});
    expect(typeof res.total).toBe("number");
  });
});

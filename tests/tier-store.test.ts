/**
 * Tier Store tests — Enhanced Protocol Phase 1.
 *
 * Defines the contract for hot/warm/cold tiering BEFORE implementation.
 * Run: npx jest tests/tier-store.test.ts
 */

import { TierStore, TierEntry } from "../src/tier-store.js";

function entry(id: string, opts: Partial<TierEntry> = {}): TierEntry {
  return {
    id,
    text: opts.text ?? `memory ${id}`,
    namespace: opts.namespace ?? "default",
    tags: opts.tags ?? [],
    priority: opts.priority ?? "medium",
    timestamp: opts.timestamp ?? Date.now(),
    tier: opts.tier ?? "hot",
  };
}

describe("TierStore", () => {
  let store: TierStore;

  beforeEach(() => {
    store = new TierStore({ hotLimit: 3, warmLimit: 5 });
  });

  describe("hot tier", () => {
    test("holds up to hotLimit entries", () => {
      store.put(entry("a"));
      store.put(entry("b"));
      store.put(entry("c"));
      expect(store.hotCount()).toBe(3);
    });

    test("demotes lowest-priority item to warm on overflow", () => {
      store.put(entry("a", { priority: "high" }));
      store.put(entry("b", { priority: "low" }));
      store.put(entry("c", { priority: "medium" }));
      store.put(entry("d", { priority: "high" }));
      // 'b' (low) should have been demoted, not 'a' or 'd' (high)
      expect(store.hotCount()).toBe(3);
      expect(store.warmCount()).toBe(1);
      const warm = store.listWarm();
      expect(warm[0].id).toBe("b");
      expect(store.getTier("b")).toBe("warm");
    });

    test("breaks priority ties by oldest timestamp", () => {
      store.put(entry("old", { priority: "medium", timestamp: 1000 }));
      store.put(entry("mid", { priority: "medium", timestamp: 2000 }));
      store.put(entry("new", { priority: "medium", timestamp: 3000 }));
      store.put(entry("newest", { priority: "medium", timestamp: 4000 }));
      const warm = store.listWarm();
      expect(warm.map((e) => e.id)).toContain("old");
      expect(store.getTier("old")).toBe("warm");
    });
  });

  describe("warm tier", () => {
    test("demotes lowest-priority then oldest to cold on overflow", () => {
      // Fill hot(3) + warm(5) + trigger overflow
      for (let i = 0; i < 9; i++) {
        store.put(entry(`m${i}`, {
          priority: i === 4 ? "low" : "medium",
          timestamp: 1000 + i,
        }));
      }
      // 9 total: hot=3, warm=5, cold=1
      expect(store.hotCount() + store.warmCount() + store.coldCount()).toBe(9);
      expect(store.warmCount()).toBeLessThanOrEqual(5);
      expect(store.coldCount()).toBeGreaterThanOrEqual(1);
      // The low-priority item must be the one pushed to cold first
      expect(store.getTier("m4")).toBe("cold");
    });
  });

  describe("prune", () => {
    test("reports what moved where and never deletes", () => {
      for (let i = 0; i < 9; i++) store.put(entry(`p${i}`));
      const report = store.prune();
      expect(report.total).toBe(9);
      expect(report.hot + report.warm + report.cold).toBe(9);
      // Nothing lost — every id still resolvable
      for (let i = 0; i < 9; i++) {
        expect(store.getTier(`p${i}`)).toBeDefined();
      }
    });
  });

  describe("snapshot", () => {
    test("round-trips hot+warm through a plain object", () => {
      store.put(entry("h1", { priority: "high" }));
      store.put(entry("h2"));
      store.put(entry("h3"));
      store.put(entry("overflow")); // pushes one to warm

      const snap = store.snapshot();
      const restored = TierStore.fromSnapshot(snap, { hotLimit: 3, warmLimit: 5 });

      expect(restored.hotCount()).toBe(store.hotCount());
      expect(restored.warmCount()).toBe(store.warmCount());
      expect(restored.getTier("h1")).toBe(store.getTier("h1"));
    });
  });

  describe("search merge", () => {
    test("merges hot + warm + cold and tags each result with its tier", async () => {
      store.put(entry("hot1", { text: "alpha hot" }));
      store.put(entry("hot2", { text: "beta hot" }));
      store.put(entry("hot3", { text: "gamma hot" }));
      store.put(entry("warm1", { text: "alpha warm" })); // demoted

      const results = await store.search("alpha", 10);
      const ids = results.map((r) => r.id);
      expect(ids).toContain("hot1");
      expect(ids).toContain("warm1");
      expect(results.every((r) => r.tier)).toBe(true);
    });
  });
});

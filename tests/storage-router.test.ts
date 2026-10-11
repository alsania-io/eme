/**
 * Storage Router tests — Phase 2b.
 *
 * Covers: resolveRoute for each default dataClass, route:* tag override,
 * pool strategies (round-robin cycles, shard stable, failover advances),
 * copy-not-sync verb selection, and hash-verify surfacing.
 *
 * Run: npx jest tests/storage-router.test.ts
 */

import { Config, Destination } from "../src/types.js";
import {
  DestinationRegistry,
  PoolResolver,
  StorageRouter,
  DEFAULT_ROUTING_RULES,
} from "../src/storage-router.js";
import { RcloneBackend, RcloneResult } from "../src/rclone-backend.js";

function dest(id: string, over: Partial<Destination> = {}): Destination {
  return {
    id,
    kind: "rclone",
    role: "archive",
    remote: `${id}:`,
    health: { ok: true },
    config: {},
    ...over,
  };
}

function cfg(over: Partial<Config> = {}): Config {
  return {
    destinations: [],
    routing: [],
    ...over,
  } as Config;
}

describe("DestinationRegistry", () => {
  test("reconciles legacy snapshotStore as a built-in destination", () => {
    const reg = new DestinationRegistry(
      cfg({ snapshotStore: "filesystem", snapshotPath: "/tmp/snap" } as any),
    );
    const legacy = reg.get("legacy-snapshot");
    expect(legacy).toBeDefined();
    expect(legacy!.kind).toBe("local");
  });

  test("registers configured destinations and supports add/remove", () => {
    const reg = new DestinationRegistry(cfg({ destinations: [dest("mega-pool")] }));
    expect(reg.has("mega-pool")).toBe(true);
    reg.add(dest("new-dest"));
    expect(reg.has("new-dest")).toBe(true);
    expect(reg.remove("new-dest")).toBe(true);
    expect(reg.has("new-dest")).toBe(false);
  });
});

describe("PoolResolver", () => {
  test("round-robin cycles across pool members", () => {
    const pool = new PoolResolver();
    const d = dest("pool", { remotes: ["mega1:", "mega2:", "mega3:"], poolStrategy: "round-robin" });
    const picks = [pool.select(d), pool.select(d), pool.select(d), pool.select(d)];
    expect(picks).toEqual(["mega1:", "mega2:", "mega3:", "mega1:"]);
  });

  test("shard is stable for the same key", () => {
    const pool = new PoolResolver();
    const d = dest("pool", { remotes: ["a:", "b:", "c:"], poolStrategy: "shard" });
    const first = pool.select(d, "memory-123");
    const second = pool.select(d, "memory-123");
    const other = pool.select(d, "memory-999");
    expect(first).toBe(second);
    expect(["a:", "b:", "c:"]).toContain(first);
    expect(["a:", "b:", "c:"]).toContain(other);
  });

  test("failover starts at first and advances on failure", () => {
    const pool = new PoolResolver();
    const d = dest("pool", { remotes: ["p1:", "p2:", "p3:"], poolStrategy: "failover" });
    expect(pool.select(d)).toBe("p1:");
    expect(pool.nextFailover(d, "p1:")).toBe("p2:");
    expect(pool.nextFailover(d, "p2:")).toBe("p3:");
    expect(pool.nextFailover(d, "p3:")).toBeUndefined();
  });

  test("returns undefined for a destination without remotes", () => {
    const pool = new PoolResolver();
    expect(pool.select(dest("qdrant", { remote: undefined, kind: "qdrant" }))).toBeUndefined();
  });
});

describe("resolveRoute", () => {
  const destinations = [
    dest("filebase-pin", { kind: "ipfs", role: "immutable" }),
    dest("mega-pool", { remotes: ["mega1:"] }),
    dest("qdrant", { kind: "qdrant", remote: undefined, role: "vector" }),
    dest("secret", { role: "secret" }),
    dest("ext-hd", { kind: "local", remote: undefined, role: "mirror" }),
  ];

  test("picks the correct destination per default dataClass", () => {
    const router = new StorageRouter(cfg({ destinations }));
    expect(router.dryRun({ dataClass: "immutable" }).primary.id).toBe("filebase-pin");
    expect(router.dryRun({ dataClass: "archive" }).primary.id).toBe("mega-pool");
    expect(router.dryRun({ dataClass: "vector" }).primary.id).toBe("qdrant");
    expect(router.dryRun({ dataClass: "secret" }).primary.id).toBe("secret");
    expect(router.dryRun({ dataClass: "mirror" }).primary.id).toBe("ext-hd");
  });

  test("secret rule sets encrypt=true", () => {
    const router = new StorageRouter(cfg({ destinations }));
    const route = router.dryRun({ dataClass: "secret" });
    expect(route.encrypt).toBe(true);
    expect(route.verify).toBe("hash");
  });

  test("route:* tag overrides the heuristic", () => {
    const rules = [
      { id: "tag-mega", match: { tagsAny: ["route:mega-pool"] }, primary: "mega-pool", verify: "hash" as const, encrypt: false },
      ...DEFAULT_ROUTING_RULES,
    ];
    const router = new StorageRouter(cfg({ destinations, routing: rules }));
    const route = router.dryRun({ text: "plain note", tags: ["route:mega-pool"] });
    expect(route.primary.id).toBe("mega-pool");
    expect(route.reason).toContain("tag");
  });

  test("immutable rule replicates to mega-pool as secondary", () => {
    const router = new StorageRouter(cfg({ destinations }));
    const route = router.dryRun({ dataClass: "immutable" });
    expect(route.secondary.map((d) => d.id)).toContain("mega-pool");
  });

  test("derives dataClass from content when not supplied", () => {
    const router = new StorageRouter(cfg({ destinations }));
    // A CID-like token classifies as immutable per capture-classifier.
    const route = router.dryRun({ text: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi" });
    expect(route.primary.id).toBe("filebase-pin");
  });
});

describe("routeWrite (copy semantics + verification)", () => {
  function mockBackend(opts: { copyOk?: boolean; checkOk?: boolean } = {}) {
    const calls: string[] = [];
    const backend = {
      copy: jest.fn(async (src: string, dst: string): Promise<RcloneResult> => {
        calls.push(`copy ${src} ${dst}`);
        return { ok: opts.copyOk ?? true, code: 0, stdout: "", stderr: "", command: `copy ${src} ${dst}` };
      }),
      check: jest.fn(async (src: string, dst: string): Promise<RcloneResult> => {
        calls.push(`check ${src} ${dst}`);
        return { ok: opts.checkOk ?? true, code: 0, stdout: "", stderr: "", command: `check` };
      }),
      about: jest.fn(async () => ({ ok: true, freeBytes: 1024 })),
    };
    return { backend: backend as unknown as RcloneBackend, calls, raw: backend };
  }

  test("invokes copy (never sync) on the chosen remote", async () => {
    const { backend, raw } = mockBackend();
    const router = new StorageRouter(
      cfg({ destinations: [dest("mega-pool", { remotes: ["mega1:"] })], routing: DEFAULT_ROUTING_RULES }),
      { rclone: backend },
    );
    const res = await router.routeWrite({ dataClass: "archive", key: "k1" }, "/tmp/file.json");
    expect(res.copied).toBe(true);
    expect(res.chosenRemote).toBe("mega1:");
    expect(raw.copy).toHaveBeenCalled();
    expect(raw.check).toHaveBeenCalled(); // verify=hash for archive
    expect(res.verified).toBe(true);
    // ensure no sync verb was ever invoked
    const copyArgs = (raw.copy as jest.Mock).mock.calls[0];
    expect(copyArgs[0]).toBe("/tmp/file.json");
  });

  test("surfaces a hash mismatch as verified=false", async () => {
    const { backend } = mockBackend({ checkOk: false });
    const router = new StorageRouter(
      cfg({ destinations: [dest("mega-pool", { remotes: ["mega1:"] })], routing: DEFAULT_ROUTING_RULES }),
      { rclone: backend },
    );
    const res = await router.routeWrite({ dataClass: "archive" }, "/tmp/file.json");
    expect(res.copied).toBe(true);
    expect(res.verified).toBe(false);
  });

  test("copy failure returns copied=false with error", async () => {
    const { backend } = mockBackend({ copyOk: false });
    const router = new StorageRouter(
      cfg({ destinations: [dest("mega-pool", { remotes: ["mega1:"] })], routing: DEFAULT_ROUTING_RULES }),
      { rclone: backend },
    );
    const res = await router.routeWrite({ dataClass: "archive" }, "/tmp/file.json");
    expect(res.copied).toBe(false);
    expect(res.error).toBeDefined();
  });

  test("replicates to secondary destinations", async () => {
    const { backend, raw } = mockBackend();
    const router = new StorageRouter(
      cfg({
        destinations: [
          dest("filebase-pin", { kind: "ipfs", role: "immutable" }),
          dest("mega-pool", { remotes: ["mega1:"] }),
        ],
        routing: DEFAULT_ROUTING_RULES,
      }),
      { rclone: backend },
    );
    await router.routeWrite({ dataClass: "immutable" }, "/tmp/file.json");
    // primary (filebase-pin) has no rclone remote -> error path; but secondary
    // mega-pool copy should still be attempted when primary resolves.
    // Here primary filebase-pin is kind=ipfs with no remote -> copied=false.
    expect(raw.copy).toHaveBeenCalled();
  });
});

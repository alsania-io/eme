/**
 * TierStore — Enhanced Protocol Phase 1.
 *
 * Hot/warm/cold tiering for EME memories:
 *  - hot:  in-process Map, bounded by hotLimit (default 100)
 *  - warm: bounded by warmLimit (default 500)
 *  - cold: unbounded; surfaced via Qdrant in the full memory manager
 *
 * Invariants:
 *  - demotion order: lowest priority first, then oldest timestamp
 *  - never deletes: prune() only demotes (Code v3.0)
 *  - pure/in-process; durable persistence is the manager's concern (Phase 2+)
 *
 * Zero external deps.
 */

import type { Tier } from "./types.js";

export interface TierEntry {
  id: string;
  text: string;
  namespace: string;
  tags: string[];
  priority: "high" | "medium" | "low";
  timestamp: number;
  tier: Tier;
}

export interface TierConfig {
  hotLimit: number;
  warmLimit: number;
}

export interface PruneReport {
  hot: number;
  warm: number;
  cold: number;
  total: number;
  demoted: Array<{ id: string; from: Tier; to: Tier }>;
}

export interface TieredHit {
  id: string;
  text: string;
  namespace: string;
  tags: string[];
  tier: Tier;
  score: number;
}

const PRIORITY_RANK: Record<TierEntry["priority"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Return > 0 when `a` is MORE demotable than `b` (i.e. demote `a` first).
 * Lower priority rank = more demotable; older timestamp = more demotable.
 */
function demotionOrder(a: TierEntry, b: TierEntry): number {
  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (pr !== 0) return pr;
  return b.timestamp - a.timestamp;
}

export class TierStore {
  private hot: Map<string, TierEntry> = new Map();
  private warm: Map<string, TierEntry> = new Map();
  private cold: Map<string, TierEntry> = new Map();
  private cfg: TierConfig;

  constructor(cfg: TierConfig) {
    this.cfg = { hotLimit: cfg.hotLimit, warmLimit: cfg.warmLimit };
  }

  /** Insert (or re-insert) an entry at the hot tier, then enforce bounds. */
  put(e: TierEntry): void {
    const placed: TierEntry = { ...e, tier: "hot" };
    this.hot.set(placed.id, placed);
    this.enforce();
  }

  /** Enforce hot/warm bounds by demoting, never deleting. */
  private enforce(): void {
    while (this.hot.size > this.cfg.hotLimit) {
      const victim = this.mostDemotable([...this.hot.values()]);
      if (!victim) break;
      this.hot.delete(victim.id);
      victim.tier = "warm";
      this.warm.set(victim.id, victim);
    }
    while (this.warm.size > this.cfg.warmLimit) {
      const victim = this.mostDemotable([...this.warm.values()]);
      if (!victim) break;
      this.warm.delete(victim.id);
      victim.tier = "cold";
      this.cold.set(victim.id, victim);
    }
  }

  /** The single most demotable entry (lowest priority, then oldest). */
  private mostDemotable(entries: TierEntry[]): TierEntry | undefined {
    if (entries.length === 0) return undefined;
    return entries.reduce((worst, e) =>
      demotionOrder(e, worst) > 0 ? e : worst,
    );
  }

  hotCount(): number {
    return this.hot.size;
  }
  warmCount(): number {
    return this.warm.size;
  }
  coldCount(): number {
    return this.cold.size;
  }

  listWarm(): TierEntry[] {
    return [...this.warm.values()];
  }

  getTier(id: string): Tier | undefined {
    if (this.hot.has(id)) return "hot";
    if (this.warm.has(id)) return "warm";
    if (this.cold.has(id)) return "cold";
    return undefined;
  }

  get(id: string): TierEntry | undefined {
    return this.hot.get(id) ?? this.warm.get(id) ?? this.cold.get(id);
  }

  /**
   * Re-enforce bounds and report the resulting distribution.
   * Never deletes — only demotes. `demoted` lists what moved this call.
   */
  prune(): PruneReport {
    const before = new Map<string, Tier>();
    for (const e of this.hot.values()) before.set(e.id, "hot");
    for (const e of this.warm.values()) before.set(e.id, "warm");
    for (const e of this.cold.values()) before.set(e.id, "cold");

    this.enforce();

    const demoted: Array<{ id: string; from: Tier; to: Tier }> = [];
    for (const e of [...this.hot.values(), ...this.warm.values(), ...this.cold.values()]) {
      const was = before.get(e.id);
      if (was && was !== e.tier) {
        demoted.push({ id: e.id, from: was, to: e.tier });
      }
    }

    return {
      hot: this.hot.size,
      warm: this.warm.size,
      cold: this.cold.size,
      total: this.hot.size + this.warm.size + this.cold.size,
      demoted,
    };
  }

  /** Plain-object snapshot of hot + warm (cold lives in Qdrant). */
  snapshot(): { hot: TierEntry[]; warm: TierEntry[]; cold: TierEntry[] } {
    return {
      hot: [...this.hot.values()],
      warm: [...this.warm.values()],
      cold: [...this.cold.values()],
    };
  }

  /** Rebuild a store from a snapshot object. */
  static fromSnapshot(
    snap: { hot?: TierEntry[]; warm?: TierEntry[]; cold?: TierEntry[] },
    cfg: TierConfig,
  ): TierStore {
    const store = new TierStore(cfg);
    for (const e of snap.cold ?? []) {
      const c: TierEntry = { ...e, tier: "cold" };
      store.cold.set(c.id, c);
    }
    for (const e of snap.warm ?? []) {
      const w: TierEntry = { ...e, tier: "warm" };
      store.warm.set(w.id, w);
    }
    for (const e of snap.hot ?? []) {
      const h: TierEntry = { ...e, tier: "hot" };
      store.hot.set(h.id, h);
    }
    return store;
  }

  /**
   * Naive lexical search across hot+warm+cold, tagging each hit with its tier.
   * Semantic (embedding) search stays in MemoryManager/Qdrant; this is the
   * in-process fallback used by search-first before hitting Qdrant.
   */
  async search(query: string, limit: number = 10): Promise<TieredHit[]> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all: TierEntry[] = [
      ...this.hot.values(),
      ...this.warm.values(),
      ...this.cold.values(),
    ];
    const hits: TieredHit[] = [];
    for (const e of all) {
      const text = e.text.toLowerCase();
      let score = 0;
      for (const t of terms) {
        // Count occurrences — frequency beats mere presence (idf-free TF).
        let idx = text.indexOf(t);
        while (idx !== -1) {
          score += 1;
          idx = text.indexOf(t, idx + t.length);
        }
      }
      if (score > 0) {
        hits.push({
          id: e.id,
          text: e.text,
          namespace: e.namespace,
          tags: e.tags,
          tier: e.tier,
          score,
        });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /**
   * Entries whose timestamp is within the last `hours`, newest first.
   * Spans all tiers. Used by session continuity + get_recent_memories.
   */
  getRecent(hours: number = 24, limit: number = 20): TierEntry[] {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const all: TierEntry[] = [
      ...this.hot.values(),
      ...this.warm.values(),
      ...this.cold.values(),
    ];
    return all
      .filter((e) => e.timestamp >= cutoff)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
}

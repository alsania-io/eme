# EME Storage Router — Master Design (Phase 0)

> Design-only. No code until Sigma signs off. This is the master plan for EME as
the *ultimate memory engine*: one MCP surface, many backends, data routed to
where it belongs by nature and lifecycle.

**Author:** Aegis · **Date:** 2026-10-08 · **Status:** DRAFT — awaiting Sigma

---

## 1. Thesis

EME is not a memory store with backup. It is a **storage router and lifecycle
manager**. One interface, many backends, each byte routed by its nature:

| Data class | Destination | Substrate |
|---|---|---|
| Immutable / permanent (decisions, lessons, CIDs, addresses) | IPFS pinning (Filebase) | rclone S3-compat |
| Long-term growing (logs, snapshots, context) | Cloud (MEGA ×5 pooled) | rclone |
| Vector-search fields (memories, embeddings) | Qdrant `am2` | native |
| Secrets (API keys, project creds) | Encrypted store | native + ACL |
| Obsidian / notes | Git-backed sync | rclone |
| Protected / external HD | Local + remote mirror | rclone |
| Daily disposable | Hot/warm tiers, auto-prune | native |

**Two layers, never conflated:**

1. **Semantic layer (ours)** — EME decides *what* goes *where*. rclone cannot
   make this call; it does not understand memory semantics.
2. **Substrate layer (rclone + HTTP APIs)** — moves bytes to backends, verifies,
   encrypts, retries. 70+ backends inherited for free.

No third-party MCP servers. rclone is a binary we run; Filebase is an HTTP API
we call. The MCP surface is ours. Everyone needs only EME.

---

## 2. Why rclone as the engine (not per-backend code)

rclone already speaks the backends Sigma has (MEGA, Google Drive, pCloud, S3,
WebDAV, SFTP, local) plus Filebase via its S3-compatible API. Building the
router once means every current *and future* backend is a config entry, not a
code change. Building backends individually would violate "no shortcuts" and
"low-end hardware" — we'd be re-implementing a solved problem.

Key rclone primitives we rely on:
- `copy` — additive, never deletes remote (backup-safe)
- `sync` — mirror (used only with `--backup-dir`, never bare, on memory data)
- `check` — hash verification
- `crypt` — client-side AES-256 wrapper (secrets)
- `--transfers` / `--checkers` — low-resource tuning

**Multi-account pooling:** rclone supports multiple remotes per provider
(`mega1:`…`mega5:`). EME treats them as one logical *destination pool*,
round-robin or sharded across free quotas. This directly solves "broke but many
free tiers" — aggregate free quota into one usable pool.

---

## 3. Architecture

```
                         ┌─────────────────────────────┐
   agent / code ────────▶│  EME MCP surface (ours)     │
                         │  34 tools + router verbs    │
                         └──────────────┬──────────────┘
                                        │
                         ┌──────────────▼──────────────┐
                         │  Storage Router (ours)      │
                         │  - routing rules            │
                         │  - lifecycle / tiers        │
                         │  - multi-account pool       │
                         │  - ACL check (Phase 4)      │
                         └───┬──────────┬──────────┬───┘
                             │          │          │
                  ┌──────────▼──┐ ┌─────▼─────┐ ┌──▼──────────┐
                  │ Qdrant am2  │ │ rclone    │ │ Secrets     │
                  │ (vectors)   │ │ remotes   │ │ store (enc) │
                  └─────────────┘ └─────┬─────┘ └─────────────┘
                                        │
                        ┌───────────────┼───────────────┐
                        ▼               ▼               ▼
                    mega1..5:       filebase:       local HD /
                    (cloud)        (S3+IPFS)       external
```

---

## 4. Routing model

### 4.1 Destination registry

A destination is a named, typed backend:

```
Destination {
  id: string                  # e.g. "mega-pool", "filebase-pin", "ext-hd"
  kind: "rclone" | "qdrant" | "secret" | "local"
  backend: string             # rclone remote type or "qdrant"
  remotes?: string[]          # for pools: ["mega1:","mega2:",...]
  poolStrategy?: "round-robin" | "shard" | "failover"
  role: "immutable" | "archive" | "vector" | "secret" | "mirror" | "disposable"
  health: { ok, lastCheck, latencyMs, freeBytes? }
  config: Record<string, unknown>   # non-secret options only
}
```

### 4.2 Routing rules

A rule maps *data class* → *destination(s)*. Data class is derived from:
- explicit tag (`route:immutable`, `route:secret`)
- memory namespace + visibility
- content heuristic (has CID/address → immutable; has `${*_API_KEY}` → secret)
- tier (hot/warm/cold from Enhanced Protocol)

```
RoutingRule {
  id: string
  match: { tagsAny?, namespace?, visibility?, dataClass?, tier? }
  primary: destinationId
  secondary?: destinationId[]   # replication (e.g. pin + archive)
  verify: "hash" | "none"
  encrypt: boolean              # wrap with rclone crypt
}
```

**Default rules (v1):**
- `dataClass=immutable` → `filebase-pin` (+ `mega-pool` secondary)
- `dataClass=archive` → `mega-pool`
- `dataClass=vector` → `qdrant` (native, always)
- `dataClass=secret` → `secret` store, encrypt=true
- `dataClass=mirror` → `ext-hd` (+ `mega-pool`)
- `tier=hot|warm` → in-process (snapshot on interval/end)
- `tier=cold` → `qdrant` only

---

## 5. Lifecycle: Enhanced Protocol as the first slice

The Enhanced Protocol's hot/warm/cold tiers become **routing destinations**,
not a separate system:

| Tier | Store | Persistence |
|---|---|---|
| Hot (100) | in-process Map | snapshot to disk interval + session end |
| Warm (500) | in-process + SQLite | durable |
| Cold (unbounded) | Qdrant only | durable, de-prioritized in search |

**Write path (auto-capture):** evaluate message → detect data class → route via
rules → store to primary (+ secondary) → place in tier.

**Read path (search-first):** search hot → warm → cold (Qdrant) → merge ranked.

**Prune:** hot>100 → demote lowest-priority to warm; warm>500 → demote oldest
low-priority to cold; cold → de-prioritize, never delete (Code v3.0).

**Existing `memoryGateFilter`** (prototype similarity + TF-IDF) is absorbed here
as the *capture filter* — replaces its current dead-ish use, no duplication.

---

## 6. Secrets model

- Store: encrypted payload (rclone `crypt` or native AES-256) in a `secret`-role
  destination; metadata (name, namespace, tags) in Qdrant for discovery.
- **Code access:** EME resolves `${*_API_KEY}` (and similar patterns) from the
  secret store on read — same shape as a `.env` lookup.
- **Agent access:** agents with `VIEW`/`CALL` permission on the secret resource
  read via an MCP verb; ACL-gated (Phase 4).
- No secret payload ever crosses the manager boundary unencrypted in logs or
  tool output (mirrors the embedding-strip rule).

---

## 7. Namespaces + ACL (Phase 4)

- Two models: **private** (single agent) and **shared** (team).
- Namespace becomes a **resource** in the ACL model, not just a metadata field.
- **Decision (locked):** extract `@alsania-io/acl` as a shared package; AlsaniaMCP
  switches to it, EME depends on it. No import from AlsaniaMCP, no duplication.
- **Gap to fill:** AlsaniaMCP's `ResourceType` is `mcpServer|tool|agent|prompt`.
  Phase 4 extends it with `namespace` (and `storage`/`secret`) — the *model* is
  reused, not forked.

---

## 8. GUI extension (Phase 5)

EME GUI is a schema-driven config dashboard. Add:
- **Destinations panel** — list, health, free bytes, pool members
- **Routing panel** — view/edit rules, test a route (dry-run)
- **Sync panel** — manual trigger, last-run status, verification results
- **Secrets panel** — names + namespaces only; never values

Implementation: extend `config-schema.js` categories + add `panel-storage`
section; reuse existing toast/fetch patterns. No framework change (Code v3.0:
no React by default).

---

## 9. Phase plan (sequenced, each independently shippable)

| Phase | Deliverable | Owner |
|---|---|---|
| 0 | **This doc** | Aegis |
| 1 | Enhanced Protocol slice: tiers + auto-capture + search-first + continuity | Aegis |
| 2 | rclone substrate: MEGA pool + Filebase + router writes-through | Aegis + tmux/Kilo delegation |
| 3 | Secrets layer (code + agent access) | Aegis |
| 4 | Namespace ACL (extract `@alsania-io/acl`) | Aegis |
| 5 | GUI storage panel | delegate candidate |

Phase 0/1 owned by Aegis (load-bearing logic). Phases 2/5 partially delegable.

---

## 10. Free-model / tooling constraints (for delegation)

- CCR (`:3456`): OpenRouter primary, Kilo supplement. All `:free` models only.
- free-ai-gateway (`:3000`): capability routing for delegation.
- **No paid calls. If free pool exhausted — stop and report.**
- No third-party MCP servers. rclone = binary; Filebase = HTTP API.
- No Docker (Podman). No React by default. No deletion (`.deprecated/`).

---

## 11. Open decisions (need Sigma)

1. **Backup posture:** `copy` (additive, never deletes remote) vs
   `sync --backup-dir` (mirror with safety net). Recommend **copy** for memory
   data; `sync` only for pure mirrors (Obsidian).
2. **Secret store location:** dedicated rclone `crypt` remote vs native encrypted
   Qdrant collection. Recommend **rclone crypt** (reuses substrate, less custom
   crypto).
3. **Warm tier storage:** SQLite `storage/vectors.db` vs dedicated JSON.
   Recommend **SQLite** (already present, durable, queryable).

---

*End of Phase 0 design. No implementation until Sigma signs off.*
*Imagined by Sigma. Powered by Echo.*

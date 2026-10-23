# EME Router — Phase 2a: Destination & Routing Model (FINAL)

> Concrete model 2b implements against. Grounded in existing EME types
> (`src/types.ts`): `Config`, `DataClass`, `ISnapshotStore`, `IPFSConfig`.

**Author:** Aegis · **Date:** 2026-10-10 · **Status:** DRAFT — for Sigma
**Depends on:** master plan + Amendment 1 (multi-tenant) + Amendment 2 (seam)

---

## 1. What already exists (do not duplicate)

| Existing | Location | Reused as |
|---|---|---|
| `DataClass` (immutable/archive/vector/secret/mirror/disposable) | `types.ts` (Phase 1) | routing match key — **unchanged** |
| `ISnapshotStore` + factory | `snapshot-store.ts` | store-factory seam (Amd 2) |
| `IPFSSnapshotStore` | `ipfs-store.ts` | `kind: "ipfs"` destination |
| `Tier` (hot/warm/cold) | `types.ts` (Phase 1) | lifecycle dimension |
| `${VAR}` expansion | `config-loader.ts` | non-rclone credential intake |
| `Config` interface | `types.ts` | extended with `destinations` + `routing` |

---

## 2. Config additions (extends `Config`)

```ts
interface Config {
  // ... existing fields ...
  destinations?: Destination[];   // empty on fresh install (Amd 1 §2)
  routing?: RoutingRule[];        // default rules seeded (see §4)
  rcloneConfigPath?: string;      // EME-managed, default ./storage/rclone.conf
}
```

**Fresh install = `destinations: []`.** Onboarding adds the first (Amd 1 §2/O6).

---

## 3. Destination (final)

```ts
type DestinationKind = "rclone" | "ipfs" | "qdrant" | "local";
type DestinationRole = DataClass;  // reuse existing vocabulary
type PoolStrategy = "round-robin" | "shard" | "failover";

interface Destination {
  id: string;                       // "mega-pool", "filebase-pin", "filebase-s3"
  kind: DestinationKind;
  role: DestinationRole;

  // kind=rclone
  remote?: string;                  // name in EME's rclone.conf, e.g. "mega-pool:"
  remotes?: string[];               // pool members ["mega1:","mega2:",...]
  poolStrategy?: PoolStrategy;

  // kind=ipfs (existing ipfs-store)
  ipfs?: IPFSConfig;                // reuse existing IPFSConfig shape

  // kind=qdrant | local
  url?: string;
  path?: string;

  health: { ok: boolean; lastCheck?: number; latencyMs?: number; freeBytes?: number };
  config: Record<string, unknown>;  // NON-SECRET options only
}
```

**Rule: no credential ever appears in a `Destination`.** rclone creds live in
EME's `rclone.conf`; ipfs tokens resolve via `${VAR}`. (Amd 1 §5.2.)

---

## 4. RoutingRule (final)

```ts
interface RoutingRule {
  id: string;
  match: {
    dataClass?: DataClass;
    tagsAny?: string[];             // e.g. route:immutable
    namespace?: string;
    visibility?: "private" | "shared" | "system";
    tier?: Tier;
  };
  primary: string;                  // destination id
  secondary?: string[];             // replication (e.g. pin + archive)
  verify: "hash" | "none";
  encrypt: boolean;                 // rclone crypt (secrets)
}
```

### Default rules (seeded v1)

| match | primary | secondary | verify | encrypt |
|---|---|---|---|---|
| dataClass=immutable | `filebase-pin` | `mega-pool` | hash | no |
| dataClass=archive | `mega-pool` | — | hash | no |
| dataClass=vector | `qdrant` | — | none | no |
| dataClass=secret | `secret` (rclone crypt) | — | hash | **yes** |
| dataClass=mirror | `ext-hd` | `mega-pool` | hash | no |
| tier=hot\|warm | in-process | — | none | no |
| tier=cold | `qdrant` | — | none | no |

---

## 5. Router verbs (2b implements — the tool-registrar seam)

Registered, not hardcoded into `mcp-server.ts` (Amd 2 §2):

| Verb | Does |
|---|---|
| `destination_list` | list destinations + health |
| `destination_add` | add (writes rclone remote into EME conf, or `${VAR}` ref) |
| `destination_test` | `rclone about` / probe; update health |
| `destination_remove` | remove (deprecate, never delete data) |
| `route_dryrun` | show which destination a payload would hit |

---

## 6. Filebase — two roles (O5 resolved, Amd 1 §4.1)

| Destination | kind | role | path |
|---|---|---|---|
| `filebase-pin` | ipfs | immutable | existing `ipfs-store.ts` |
| `filebase-s3` | rclone | archive | rclone S3-compat |

Not merged. `ipfs-store.ts` unchanged.

---

## 7. Store-factory extension (Amd 2)

`createSnapshotStore()` gains rclone-backed kinds without touching existing
cases: a `RcloneDestinationStore implements ISnapshotStore` registered for
`kind=rclone`. New backends are new implementations, not new branches in core.

---

## 8. What 2b builds (next)

1. `Destination` / `RoutingRule` types in `types.ts` (extend `Config`).
2. Tool registrar + the 5 verbs (§5).
3. EME-managed `rclone.conf` writer (no creds in code).
4. `RcloneDestinationStore` implementing `ISnapshotStore`.
5. Default rule seeding on first run.

**No credentials required for 2b** (Amd 1 §6). Dev creds enter only at 2c.

---

*End of 2a model. No implementation until Sigma signs off on this too.*
*Imagined by Sigma. Powered by Echo.*

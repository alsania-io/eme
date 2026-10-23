# EME Storage Router — Amendment 1: Multi-Tenant Destinations

> Design-only amendment to `EME_STORAGE_ROUTER.md` (Phase 0). No code until
> Sigma signs off. This corrects a gap in the original plan.

**Author:** Aegis · **Date:** 2026-10-10 · **Status:** DRAFT — awaiting Sigma
**Supersedes:** the implicit assumption in §1/§4/§9 that destinations are
pre-configured with the author's credentials.

---

## 1. The gap being corrected

The original plan (§9 Phase 2) says: "rclone substrate: MEGA pool + Filebase."
The 2026-10-10 substrate probe found only **one** rclone remote configured on
the dev machine (`drive:`); no MEGA pool, no Filebase. More importantly, the
plan never states **whose** storage this is.

EME is a product for **sovereign people**, not a personal tool. Shipping with
the author's MEGA/Filebase credentials baked in would:
- route other users' memory through the author's free-tier accounts (privacy,
  quota, liability)
- violate the sovereignty axiom
- make EME a personal setup with a public face

**Decision (Sigma, 2026-10-10): EME is multi-tenant by design. Each user
provisions their own destinations. The author's config is ONE dev instance.**

---

## 2. Core principle: destinations are user-owned

| Concept | Owner |
|---|---|
| The routing mechanism | EME (ours, shipped) |
| The destinations (backends) | The user (their accounts, their creds) |
| The author's dev config | One instance among many |

EME manages the *mapping*; the user owns the *bytes*. EME never ships a
credential. A fresh install starts with **zero** destinations and guides the
user to add their first.

---

## 3. rclone config ownership — DECIDED

**Option (A): EME-managed config.** (Sigma, 2026-10-10)

- EME keeps its **own** rclone config, e.g. `storage/rclone.conf`, not the
  user's `~/.config/rclone/rclone.conf`.
- EME **never mutates** the user's system rclone config.
- EME can **import/export** remotes (escape hatch), but by default is isolated.
- Rationale: EME is a product; it owns its substrate and must not touch global
  user state. The dev instance's remotes live in EME's own config.

---

## 4. Reuse, don't reinvent: extend the existing abstraction

EME **already has** a storage abstraction (`src/snapshot-store.ts`):
- `ISnapshotStore` interface + `createSnapshotStore()` factory
- implementations: `FilesystemSnapshotStore`, `IPFSSnapshotStore` (`ipfs-store.ts`)
- `drive`/`s3` are **stubbed** (`not yet implemented`) — these are rclone-able

**The router builds ON this contract, it does not create a parallel one.**

### 4.1 Filebase — RESOLVED (O5): two roles, not one path

**Finding (2026-10-10, reading `ipfs-store.ts`):** that file is NOT a Filebase
client. It is a full in-process IPFS node (Helia + libp2p + DAG-CBOR + IPNS)
that optionally *pins* CIDs to an HTTP pinning service. So the two proposed
Filebase paths are **not competitors — they are two roles:**

| Destination | Role | Path | Use for |
|---|---|---|---|
| `filebase-pin` | immutable (CID) | existing `ipfs-store.ts` | content-addressed decisions/lessons/CIDs |
| `filebase-s3` | archive | rclone S3-compat | bulk bytes, snapshots, growing data |

**Decision: keep both, name by role, do not merge.** `ipfs-store.ts` needs no
rewrite — it slots in as destination `kind: "ipfs"` (a store-factory
implementation, per Amendment 2). Filebase-as-archive is a `kind: "rclone"`
S3 destination. O5 CLOSED.

---

## 5. Destination + credential model (the new part)

### 5.1 Destination registry (revised from original §4.1)

Add to EME config a `destinations` array. Credentials are **NOT** in this file —
only a reference to the EME-managed rclone remote name + non-secret options:

```
destinations: [
  {
    id: "mega-pool",
    kind: "rclone" | "qdrant" | "ipfs" | "local",
    remote: "mega-pool:",          # name inside EME's rclone.conf
    remotes?: ["mega1:", ...],      # pool members
    poolStrategy?: "round-robin" | "shard" | "failover",
    role: "immutable" | "archive" | "vector" | "secret" | "mirror" | "disposable",
    health: { ok, lastCheck, latencyMs, freeBytes? },
    config: { }                     # non-secret options only
  }
]
```

### 5.2 Where credentials live

- **rclone remotes** → EME-managed `storage/rclone.conf` (chmod 600), written
  by the intake path, referenced by `remote:` in the registry.
- **Non-rclone (qdrant/ipfs)** → `${VAR}` expansion in EME config, already
  supported by `config-loader.ts`.
- **Nothing secret** in the registry, in logs, or in tool output.

---

## 6. Credential intake — pulled forward from Phase 5

The original plan put the GUI storage panel in **Phase 5 (last)**. But if users
must add their own destinations, **intake is core, not a late nicety.** Reorder:

| Piece | What | Needs author creds? |
|---|---|---|
| **2a** | Destination + credential MODEL (design) | No |
| **2b** | Minimal intake path (config API / MCP verb) — add/test/list/remove a destination | No (mechanism) |
| **2c** | Provision the dev instance with ONE MEGA remote as a test fixture | Yes (dev only) |
| **2d** | Router writes-through, built against the abstraction | Uses 2c |
| **5** | GUI panel — dresses the 2b mechanism in UI | No |

The insight: **2a/2b need no credentials at all.** Design and build the
multi-tenant mechanism first; plug dev creds in at 2c to prove end-to-end.

---

## 7. Revised open decisions

Original §11 carried three. Resolutions + new ones:

| # | Decision | Resolution |
|---|---|---|
| O1 | Backup posture | **`copy`** (additive) for memory; `sync --backup-dir` only for pure mirrors |
| O2 | Secret store | **rclone `crypt`** (reuse substrate; no hand-rolled crypto) |
| O3 | Warm tier store | **SQLite** (`storage/vectors.db`, already present) |
| O4 | rclone config ownership | **(A) EME-managed** (this amendment) |
| O5 | Filebase path | ✅ **CLOSED** — two roles (see §4.1): `filebase-pin` (ipfs-store, CID) + `filebase-s3` (rclone, archive). Not merged. |
| O6 | First-run UX | Fresh install = **zero destinations**; onboarding guides first add |

---

## 8. Scope of this amendment

- ✅ Corrects the multi-tenancy gap.
- ✅ Locks rclone config ownership (A).
- ✅ Reorders intake ahead of the GUI.
- ✅ Grounds the work in the existing `ISnapshotStore` abstraction.
- ⛔ Does NOT write code.
- ⛔ Does NOT touch the author's credentials beyond 2c (a test fixture).

---

*End of Amendment 1. No implementation until Sigma signs off.*
*Imagined by Sigma. Powered by Echo.*

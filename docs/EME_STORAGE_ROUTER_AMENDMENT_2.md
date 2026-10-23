# EME Storage Router — Amendment 2: Extension Seam

> Design-only amendment to `EME_STORAGE_ROUTER.md` (Phase 0). No code until
> Sigma signs off. Cross-cutting principle — applies beyond the storage router.

**Author:** Aegis · **Date:** 2026-10-10 · **Status:** DRAFT — awaiting Sigma
**Trigger:** Sigma (2026-10-10): EME should accept new features later (plugin
style, or an easy seam) **without disturbing what already works.**

---

## 1. Principle

> **EME grows through a small number of named seams. A new capability enters
> through the smallest seam that fits and edits no existing implementation.**

This is not "make everything a plugin." Plugin-everything is over-engineering
and violates Code v3.0 (low-end hardware, no shortcuts). The rule is: **stable
core, deliberate seams, config-over-code where possible.**

---

## 2. The three seams

| Seam | Shape | Use when adding… | Example |
|---|---|---|---|
| **Store factory** | `interface` + `factory()` + implementations | a new storage backend | `ISnapshotStore` + `createSnapshotStore()` + `IPFSSnapshotStore` |
| **Tool registrar** | register a tool, do not edit the core server file | a new MCP verb | router verbs, storage verbs |
| **Routing rule** | config entry, no code | a new data class / destination | `RoutingRule` (§4.2 of master plan) |

**Preference order:** routing rule (config) > tool registrar > store factory.
Pick the smallest door. Only write new code when config cannot express it.

---

## 3. What already conforms

- **Store factory** — `src/snapshot-store.ts`: `ISnapshotStore` + factory +
  `FilesystemSnapshotStore`, `IPFSSnapshotStore`. Already a plugin pattern.
- **Data class / routing** — the router's `RoutingRule` model is config-driven by
  design: a new data class is a new rule, not new code. The good kind of plugin.
- **Tools** — 38 tools, but adding one today edits `mcp-server.ts` directly.
  This is the one seam that is NOT yet clean. Phase 2 introduces the registrar.

---

## 4. Rules (hard)

1. A new feature **may not edit an existing implementation** to add itself.
   It registers, extends, or is configured in.
2. A new store backend implements `ISnapshotStore` (or the router's equivalent)
   and registers in the factory. Nothing else changes.
3. A new tool registers via the registrar. The core server file is not touched.
4. A new data class / destination is a **config entry**, not code.
5. Deprecation follows Code v3.0: move to `.deprecated/`, never delete.
6. Every seam has **one owner** and a **proof line** (per self-improvement gate).

---

## 5. Anti-patterns (what NOT to do)

- Do NOT add an `if (featureX)` branch to a core file to enable a capability.
- Do NOT fork an existing store to "extend" it — implement the interface.
- Do NOT hardcode a backend, model, or destination in core logic.
- Do NOT build a general plugin loader framework before a second real plugin
  exists. (YAGNI: generalize on the third instance, not the first.)

---

## 6. Scope

- ✅ Names the seam principle; standardizes the three doors.
- ✅ Keeps the core stable across future features.
- ✅ Applies to the router AND beyond (memory ops, tools, backends).
- ⛔ Does NOT write a plugin framework.
- ⛔ Does NOT refactor existing code (registrar lands in Phase 2 where it is
  actually needed).

---

*End of Amendment 2. No implementation until Sigma signs off.*
*Imagined by Sigma. Powered by Echo.*

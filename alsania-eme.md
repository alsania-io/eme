Project: Echo Memory Engine (EME)
Role: The unified memory layer for all Alsania agents, tools, and UIs, implemented as:

A core Node or Python memory engine inside alsaniamcp

An MCP tool set exposed via AlsaniaMCP (port 8050)

A reverse-proxy memory layer integrated into Alsania Gateway (port 8052)

A shared moderation + visualization UI in the AlsaniaMCP / Unified frontends

A storage & snapshot system compatible with existing mcp-memory, Qdrant, IPFS, and Scribe’s chronicle

No external “MemLayer”, LangChain, Mem0, etc.
Everything is Alsania-owned and maintained.

1. High-Level Goals

Give all Alsania agents (Core, Scribe, Aegis, Sentinel, etc.) a shared, structured, persistent memory.

Unify:

Qdrant semantic memory

Graph-style structured memory

Snapshots / chronicles

Moderated shared memory (e_sys_memory-style)

Provide a clean MCP tool interface so:

Nyx can use it

DevCon can use it

Gateway can use it

Maintain:

Local-first, offline support

Encryption / BLAKE3 IDs / namespaces

Very low resource usage

Make it monetizable later without changing the architecture.

2. Existing Building Blocks to Reuse

We do not reinvent or outsource anything you already have:

AlsaniaMCP core (port 8050)

Python backend

Existing tool schemas

Existing memory hardening ideas (BLAKE3 IDs, namespaces, auth, etc.)

Alsania Gateway (port 8052)

HTTPS entrypoint

OpenAI-compatible routing

Versioning & schema routing

Perfect place to add a memory-aware reverse proxy layer

Qdrant (port 6333)

Already your vector DB

Used for embeddings & memory

We define EME’s semantic layer here

Postgres / other DB

Used for logs or structured data

Can be used for graph layer or we can use SQLite if you prefer local files

Scribe + Chronicle system

Snapshot timeline

scribe_auto/chronicle/ directories

Log JSONL (scribe_log.jsonl) + index

We align EME snapshots with this design

BLAKE3-based IDs and namespaces from hardening passes

Already in AlsaniaMCP specs

Use them as canonical doc/message IDs

Nyx (Chrome MCP client)

Already connects to AlsaniaMCP

EME will be just another MCP tool set Nyx can call

DevCon (VSCode extension)

Uses MCP tools

Should see eme.* tools in the tool list and use them for code/memory tasks

Alsania Unified frontend

GPT-style UI, multi-mode (Ollama/relay/customgpt)

We add "Memory" panel, token meter + memory viewer, etc.

Existing mcp-memory/, echo-restore-pack, and Qdrant collections

Use them as migrations / seeds into EME

Don’t discard; we unify around them

3. Target Architecture
3.1 Components

EME Core Engine (Python package)
Lives under alsaniamcp repo, e.g.:

alsaniamcp/
  src/
    alsaniamcp/
      eme/
        __init__.py
        config.py
        storage.py
        vector_store.py
        graph_store.py
        gate.py
        snapshots.py
        schemas.py
        api.py


MCP Tool Layer
Inside AlsaniaMCP’s existing MCP server:

Tools like eme.add, eme.search, eme.update, eme.delete, eme.snapshot.save, etc.

Tools call into alsaniamcp.eme.api

Gateway Reverse Proxy Hook
In alsania-gateway:

Wrap incoming /chat or /v1/chat/completions:

Before sending to LLM: inject retrieved memories

After LLM responds: send content to EME gate for saving

Frontends

AlsaniaMCP dashboard: system-level view:

Memory moderation

Graph explorer

Namespace inspector

Alsania Unified: per-user/agent view:

“My memory” panel

Toggle memory on/off

See recent memory pulls and new saves

Storage Layer

Qdrant → semantic vectors

Local files (~/Desktop/echo-lab/mcp-memory/) → raw docs, snapshots, logs

SQLite (or Postgres) → graph & metadata (minimal schema)

IPFS (optional) → compressed snapshot archives

4. Data Model: What a “Memory Entry” Looks Like
4.1 Core Fields

Every memory entry (for vector & graph) should roughly have:

id → BLAKE3 hash (text + timestamp + agent_id)

agent_id → real agent identity (Core, Scribe, Nyx, DevCon, etc.)

via → Optional: path (Nyx, Gateway, Unified, etc.)

namespace → e.g. alsania, echo, aed, unified, chronicle, system

visibility → private | shared | system

status → pending | approved | rejected (for shared memory)

text → canonical compressed memory snippet

summary → short version used in prompts

tags → list of tags ("task", "project:aed", "chain:alsania", "agent:core" etc.)

created_at, updated_at

version_thread → optional commit hash / project version link

source → conversation, file, snapshot, manual, etc.

4.2 Qdrant Payload

embedding vector

Payload fields: mirror the above + priority, salience, score

4.3 Graph Memory

Nodes:

node_id

type ("person", "agent", "project", "task", "concept")

label

metadata (JSON)

Edges:

edge_id

src_node_id

dst_node_id

relation ("part_of", "depends_on", "updated_from", "assigned_to")

weight (float)

Stored in SQLite / Postgres; we do not bring in an external graph DB.

5. Memory Flows
5.1 Write Flow (Agent → EME)

Agent (Core, Scribe, Unified, etc.) sends content via MCP tool eme.add OR it passes through the Gateway's reverse proxy.

EME Gate runs:

Salience filter (prototype embeddings, TF-IDF, domain checks)

De-duplication (via BLAKE3 and similarity)

If passes:

Compress/summarize text

Store in:

vector_store (Qdrant)

graph_store if relevant (entities/relations)

Local raw store (JSONL per namespace)

If visibility == shared:

Mark status = pending → moderation queue

5.2 Read Flow (Agent asking a question)

Agent calls eme.search or Gateway intercepts /chat request.

EME does:

Vector search in relevant namespace(s) + agent_id

Optional graph expansion (related nodes)

Rank + merge results

Returns:

context_snippets

summaries

graph_facts

Gateway or MCP client inserts this into system/prompt context.

6. MCP Tool Spec (Echo Memory Engine)

All under a consistent prefix, e.g. eme.*.

6.1 eme.add

Add and gate new memory.

Used by agents directly and by Gateway after responses.

6.2 eme.search

Semantic + graph search.

Filters:

agent_id

namespace

visibility

status (approved vs all)

6.3 eme.update

Modify text / status / tags.

Versioned changes tracked.

6.4 eme.delete

Soft delete (move to archive).

6.5 eme.graph.add_node / eme.graph.add_edge

Manage explicit graph relations when needed (projects, tasks, etc.)

6.6 eme.snapshot.save

Save snapshot for:

namespace

agent_id

all

Dump:

Raw entries

Index

Optional: vector index metadata

Write into something like:

~/Desktop/echo-lab/mcp-memory/snapshots/eme/<date>/<namespace>-<tag>.jsonl

6.7 eme.snapshot.load

Import from snapshot into active storage.

6.8 eme.moderation.list

For Echo/Sigma UI:

List pending entries

Filter by agent, namespace, date

6.9 eme.moderation.update

Approve / reject / comment on entries.

7. Integration with Existing Systems
7.1 AlsaniaMCP (port 8050)

Tasks:

 Create alsaniamcp/eme/ Python package

 Implement API layer that MCP calls

 Register eme.* tools in MCP tool registry

 Enforce agent_id + namespace rules from existing memory spec

 Reuse BLAKE3 ID generator from existing code (if in your hardening versions)

7.2 Alsania Gateway (port 8052)

Before LLM call:

 For each /chat or /v1/chat/completions request:

Identify agent_id and user_id

Call eme.search with query and metadata

Inject returned snippets into:

system or assistant context at top of messages

After LLM response:

 Send response (or subset) to eme.add with:

agent_id, user_id, namespace, visibility

Mark force_save for explicit instructions user wants saved

Config:

 Add memory_enabled = true/false per route

 Add per-app / per-user namespace mapping

7.3 Nyx (Chrome MCP client)

Nyx already connects to MCP; we:

 Ensure eme.* tools appear in tool list

 Provide tool usage instructions:

For browsing sessions that need memory injection

For selectively saving web page content as memory

 (Later) Add Nyx-side helper UI (button: "Save this to Memory")

7.4 DevCon (VSCode extension)

 Use eme.add to store:

File-level summaries

PR descriptions

“Important note” commands from user

 Use eme.search to:

Retrieve relevant past decisions

Link to previous design reasoning

 Optional: add a DevCon panel for "Project Memory"

7.5 Alsania Unified

 Add Memory panel:

Show last N memory hits

Show "What I know about X" queries using eme.search

 Toggle:

Memory ON/OFF globally

Per-session ephemeral flag

 Use eme.add for:

User preferences

Project descriptions

Goals & tasks

7.6 Scribe & Chronicle

 eme.snapshot.save hooks that:

Mirror snapshot saving into Scribe’s chronicle index

 Allow Scribe to:

Pull from EME when writing narrative

Use eme.search as its base memory source

8. Step-by-Step Implementation Plan

I’ll keep this as actionable as possible.

PHASE 0 — Repo Prep & Structure

Goal: Clean base to plug EME into AlsaniaMCP + Gateway.

Open alsaniamcp repo.

Create folder src/alsaniamcp/eme/.

Add empty module files:

__init__.py

config.py

schemas.py

storage.py

vector_store.py

graph_store.py

gate.py

snapshots.py

api.py

Ensure alsaniamcp package setup includes eme.

In alsania-gateway repo:

Identify main router for /v1/chat/completions / /chat.

Create memory_middleware.py or eme_proxy.py for hooking pre/post-processing.

Acceptance:
Codebase compiles; no functionality yet but structure is solid.

PHASE 1 — Config & Schemas (Alsania-native)

Goal: Define all configs & models.

In eme/config.py:

Config for:

Qdrant connection

Local storage paths (point to ~/Desktop/echo-lab/mcp-memory/)

Snapshot dirs (align with Scribe patterns)

Default namespaces

Embedding model choice (Ollama / SentenceTransformers)

In eme/schemas.py:

Pydantic models or dataclasses for:

MemoryEntry

MemorySearchResult

GraphNode / GraphEdge

SnapshotDescriptor

ModerationItem

Implement BLAKE3-based ID generator using your existing hardening logic.

Acceptance:
You can import MemoryEntry and construct/validate one in a quick REPL test.

PHASE 2 — Storage Layer (Qdrant + Files + Graph DB)

Goal: Make storage.py, vector_store.py, graph_store.py fully working.

vector_store.py:

Connect to Qdrant collections:

alsania_memory (or split per namespace)

Functions:

upsert_memory(entry, embedding)

search(query_embedding, top_k, filters)

delete(id)

storage.py (raw JSONL file storage):

Directory layout e.g.:

~/Desktop/echo-lab/mcp-memory/eme/
  namespaces/
    alsania.jsonl
    echo.jsonl
    aed.jsonl
    unified.jsonl
  archive/
  logs/


Append-only writes; rotation when large.

graph_store.py:

Use SQLite or Postgres (whichever you are already leaning on in alsaniamcp).

Tables:

graph_nodes

graph_edges

Functions:

add_node, add_edge, get_neighbors, search_nodes_by_label

Acceptance:
From a small test script you can:

Create a memory entry

Store it to file + Qdrant

Create related graph nodes/edges

Search for it by semantic vector

PHASE 3 — Salience Gate & API

Goal: Implement the “brain” of the memory layer.

gate.py:

Implement:

should_save(entry):

Prototype embeddings (load from config or precomputed set)

TF-IDF / keyword/regex checks for Alsania-related key terms (alsania, aed, gateway, nyx, devcon, scribe, etc.)

Optional simple ML classifier later

process_and_save(raw_text, metadata):

Create MemoryEntry

Generate embedding

Run gate

If accepted → store via storage.py + vector_store.py + optional graph_store.py

snapshots.py:

save_snapshot(namespace, agent_id, tag)

load_snapshot(file_path, mode) (merge/overwrite options)

Use Scribe-style index naming (date + tag).

api.py:

add_memory(...)

search_memory(...)

update_memory(...)

delete_memory(...)

list_moderation(...)

update_moderation(...)

save_snapshot(...)

load_snapshot(...)

Acceptance:
CLI test script can call api.add_memory + api.search_memory and retrieve relevant entries.

PHASE 4 — MCP Tool Wiring (AlsaniaMCP)

Goal: Expose EME via AlsaniaMCP’s MCP tools.

Locate existing MCP tool registration in alsaniamcp.

Add definitions for:

eme.add

eme.search

eme.update

eme.delete

eme.graph.add_node

eme.graph.add_edge

eme.snapshot.save

eme.snapshot.load

eme.moderation.list

eme.moderation.update

Each tool:

Validates parameters (agent_id, namespace, etc).

Calls appropriate alsaniamcp.eme.api function.

Acceptance:
Nyx tool list shows eme.* tools; a MCP Inspector call confirms they work.

PHASE 5 — Gateway Reverse Proxy Integration

Goal: Invisible memory for any client using Alsania Gateway.

In alsania-gateway:

Implement middleware or wrapper for:

POST /v1/chat/completions

POST /chat or other conversation endpoints

Pre-call step:

Resolve agent_id from request (fallback to Echo if missing).

Build search query from latest user message.

Call eme.search (through MCP or direct HTTP/gRPC if you expose it internally).

Inject returned snippets into the messages:

As a system note: "Relevant memory: ..."

Or as dedicated assistant message before user message.

Post-call step:

Take final assistant response.

Call eme.add with:

text = assistant answer (or trimmed version)

agent_id, namespace, user_id, visibility

Respect gating (no flooding memory).

Config file:

Extend gateway config to include:

memory_enabled: true

memory_namespace: alsania (per app)

memory_agent_id_default: core

Acceptance:
Using any OpenAI-compatible client through Gateway, memory starts being written and read without modifying the client.

PHASE 6 — Frontend: Moderation Dashboard & Inspectors

Goal: Give you visual control.

AlsaniaMCP Dashboard:

New pages:

/memory/moderation

/memory/namespaces

/memory/graph

Use EME MCP tools to:

List pending entries (filters for agent, namespace)

Approve/reject with one click

See timeline of shared memory

Alsania Unified:

Add “Memory” tab:

“What I know about this session”

“My saved facts”

Search box → calls eme.search

Acceptance:
You can open a browser, log into local dashboards, see memory flow live, and moderate it.

PHASE 7 — Nyx & DevCon Usage Patterns

Nyx:

Define simple workflows:

When user is reading important docs:

Button “Save this page to Memory” → calls eme.add via Nyx.

When user asks: “What do we know about Aelion chain?”:

Nyx triggers eme.search and injects results before LLM call.

DevCon:

Hook into:

“Summarize this repo and save to memory”

“What did we decide about AED upgradeability last week?” → eme.search with tags.

Acceptance:
From DevCon, you can run a command + see memory; from Nyx, you can store page content and recall it.

PHASE 8 — Migration & Consolidation

Goal: Bring old memory into EME.

Write import scripts in alsaniamcp/eme/migrations/:

import_echo_restore_pack.py

import_old_qdrant_collections.py

import_scribe_chronicle.py

Map:

Old memory entries → MemoryEntry schema

Keep namespace and tags to track origin so nothing is lost.

Run migrations once, verify with search.

Acceptance:
You can search for long-ago decisions from chronicled chats and see them in EME.

PHASE 9 — Hardening, Docs & Monetization Hooks

Add:

Rate limits (so a bad agent doesn’t spam memory).

Logging of memory writes (with hashed content).

Optional encryption on disk.

Write:

README_eme.md — Internal implementation doc.

README_user_memory.md — Future public docs.

API_MEMORY_MCP.md — For external developers (monetization-ready).

Monetization (future):

Add feature flags in config for “pro-only” modules (e.g., advanced graph views, multi-tenant hosting).

Acceptance:
System feels stable, documented, and ready to be packaged as an external product if you choose.

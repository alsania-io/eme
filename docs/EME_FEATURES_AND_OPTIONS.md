# Echo Memory Engine (EME) — Features, Options & Expansion Guide

**Comprehensive Specification & Future Roadmap**
*Author: Alsania Ecosystem Architecture Team*
*Version: 1.3.0*

---

## 1. Executive Overview

Echo Memory Engine (EME) is the sovereign, local-first memory and context subsystem of the Alsania ecosystem. Designed to liberate AI agents from ephemeral context limits and centralized surveillance databases, EME combines high-dimensional vector embeddings, structured knowledge graphs, noise-filtering memory gates, and portable cryptographic snapshots.

EME operates natively over the **Model Context Protocol (MCP)** and can be invoked either via stdio or an integrated HTTP/REST bridge.

---

## 2. Complete Inventory of Built-in Features

### 2.1 Core Semantic Memory
- **Vectorized Memory Entries**: Stores text snippets alongside high-dimensional dense embeddings, timestamps, version numbers, and cryptographic identifiers.
- **Multi-Agent Namespace Isolation**: Each agent (e.g. `echo`, `cipher`, `aegis`, `scribe`) writes to its isolated namespace while retaining access to shared system pools.
- **Visibility Scopes**: Memories are tagged with granular visibility:
  - `private`: Strictly scoped to the owning agent.
  - `shared`: Accessible across the Alsanian agent mesh.
  - `system`: Read-only ecosystem axioms and runtime context.
- **Semantic Vector Search**: Top-K nearest-neighbor cosine similarity search with namespace filtering and graph expansion.
- **Full Lifecycle Operations**: Create, read, update, delete, and list memories.

### 2.2 Knowledge Graph Engine
- **Entity Graph Representation**: Stores entities (`concept`, `person`, `tool`, `task`, `event`, `project`, `state`) and directed relations (`related_to`, `is`, `part_of`, `changed_from`, `updated_on`, `owned_by`, `assigned_to`).
- **Multi-Observation Tracking**: Cumulative observations associated with entities over time.
- **Graph Metrics & Inspection**: Graph density calculation, node/edge counts, namespace distributions, and connectivity audits.
- **Entity & Node Search**: Keyword and prefix lookup across nodes and observations.

### 2.3 Memory Gate & Salience Filtering
- **Noise Blocker**: Analyzes incoming agent communications before permanent ingestion to prevent repetitive spam, trivial conversational turns, and context bloat.
- **Tunable Thresholds**: Floating-point sensitivity controls (`memoryGateThreshold` and `similarityThreshold`) to tune strictness vs. inclusivity.
- **Capacity Guards**: Hard caps (`maxMemoryEntries`) preventing unconstrained disk or RAM consumption on low-power devices.

### 2.4 Snapshots & Portable Continuity
- **Multi-Scope Snapshots**: Capture `memory`, `graph`, or `full` state into deterministic archives.
- **Storage Backends**: File system archives, IPFS/Helia pinning with CIDs, Filebase, and S3-compatible endpoints.
- **Instant Rollback**: Restores past system states for chaos testing, regression recovery, or agent migration.

### 2.5 Local Document RAG (Retrieval-Augmented Generation)
- **Direct Document Ingestion**: Ingests markdown, text, HTML, and unstructured data without sending user files to third-party clouds.
- **Semantic & Keyword Querying**: Hybrid search combining exact keyword hits with semantic dense vector matches.
- **Document Index Tracking**: Real-time stats on chunk count, file registries, and indexing integrity.

### 2.6 Large File Handling & Streaming
- **Chunked Pagination**: Read files in customizable line or byte windows, avoiding token overflows.
- **Regex & Contextual Search**: In-file pattern matching with configurable before/after context padding.
- **Byte Offset Streaming**: Fast streaming of massive binaries or logs directly into base64 or raw chunks.

### 2.7 Session Management & Turn Caching
- **Turn-based Instruction Queue**: `session_push`, `session_get`, and `session_ack` workflows for coordination.
- **Session Checkpoints**: Save and restore intermediate agent reasoning turns.

### 2.8 API Key & Tier Management
- **Key Lifecycle**: Generate, validate, list, and revoke API keys with expiration and tier assignment.
- **Usage Telemetry**: Tracks requests and quota consumption per key.

### 2.9 Health Diagnostics (Doctor Subsystem)
- **Diagnostic Audit**: Evaluates vector store reachability, Qdrant collection sanity, memory counts, graph health, and config soundness.

---

## 3. Comprehensive Breakdown of All Configuration Options

Every setting can be specified via `eme-config.json`, CLI flags, or environment variables.

| Option Key | Type | Default | Valid Options / Range | Purpose & Behavioral Impact |
|---|---|---|---|---|
| `embeddingModel` | string | `local` | `local`, `openrouter`, `openai`, `cohere`, `huggingface` | Selects primary vector embedding provider. `local` uses zero-dependency on-device models; `openrouter` routes to models like Nemotron. |
| `embeddingModelPath` | string | `undefined` | String identifier | Specific HuggingFace or OpenRouter model ID (e.g. `nvidia/llama-nemotron-embed-vl-1b-v2:free`). |
| `embeddingDimension` | integer | `384` | Positive integer (e.g. `384`, `768`, `1536`, `2048`) | Length of generated vector array. Must match vector DB collection dimension. |
| `fallbackEmbeddingModel` | string | `local` | `local`, `openrouter`, `openai`, `cohere`, `huggingface` | Automatic fallback provider if primary network embedding fails. |
| `fallbackEmbeddingDimension` | integer | `384` | Positive integer | Vector size expected by fallback embedding system. |
| `vectorStore` | string | `memory` / `qdrant` | `memory`, `sqlite`, `qdrant`, `postgres`, `lancedb`, `faiss` | Vector persistence engine. `memory` is ephemeral; `sqlite` provides local file storage; `qdrant` provides high-performance search. |
| `vectorStorePath` | string | `undefined` | File path (e.g. `./storage/vectors.db`) | Filesystem location for SQLite/LanceDB vector files. |
| `qdrantUrl` | string | `http://localhost:6333` | Valid HTTP URL | Host address and port for the Qdrant vector database server. |
| `qdrantCollection` | string | `alsania-mem` / `am2` | Collection name | Qdrant collection namespace where vectors are indexed. |
| `qdrantVectorName` | string | `undefined` | String (e.g. `v2048`) | Specific named vector slot when connecting to multi-vector Qdrant collections. |
| `postgresConnection` | string | `undefined` | Postgres URI | Database connection string for PostgreSQL enterprise storage. |
| `graphStore` | string | `memory` | `memory`, `sqlite`, `jsonl` | Knowledge graph storage backend. |
| `graphStorePath` | string | `undefined` | File path (e.g. `./storage/graph.db`) | Filesystem location for SQLite/JSONL graph storage. |
| `snapshotStore` | string | `filesystem` | `filesystem`, `ipfs`, `drive`, `s3`, `filebase` | Storage mechanism for system and memory snapshot archives. |
| `snapshotPath` | string | `./storage/snapshots` | Directory path | Local directory where snapshot bundles are stored. |
| `memoryGateEnabled` | boolean | `true` | `true`, `false` | Enables intelligent salience and noise filtering before memories are persisted. |
| `memoryGateThreshold` | float | `0.3` | `0.0` to `1.0` | Minimum salience score required for a memory to be saved. Higher = stricter. |
| `similarityThreshold` | float | `0.3` | `0.0` to `1.0` | Minimum cosine similarity score for memory retrieval queries. Higher = tighter recall. |
| `maxMemoryEntries` | integer | `10000` | Positive integer | Maximum memory items maintained before archiving or capacity warnings. |
| `encryptionKey` | string | `undefined` | 32-byte key string | Optional AES encryption key used to encrypt memory texts at rest. Redacted in API responses. |
| `logLevel` | string | `info` | `debug`, `info`, `warn`, `error` | Output verbosity level for system logs. |
| `openRouterApiKey` | string | `undefined` | Secret key (`sk-or-v1-...`) | OpenRouter API key for remote model embeddings. Redacted in API responses. |
| `openRouterReferer` | string | `undefined` | URL (e.g. `https://alsania-io.com`) | HTTP referer header passed to OpenRouter for app attribution. |
| `openRouterTitle` | string | `undefined` | String (e.g. `Echo Memory Engine`) | Application title passed to OpenRouter dashboard. |
| `development` | boolean | `false` | `true`, `false` | Enables development mode with verbose error stacks and live reload helpers. |

---

## 4. Strategic Recommendations & Suggested Features to Add

Based on ecosystem needs, user feedback patterns, and multi-agent coordination requirements, the following enhancements represent high-impact additions to EME:

### 4.1 Automated Vector Re-indexing & Model Migration
- **Current Behavior**: Switching between embedding models or dimensions requires manual collection management or potential dimension mismatch.
- **Suggested Feature**: A 1-click **Vector Migration Pipeline** that reads existing raw memory texts, batch-generates new embeddings via the updated model, and populates a new collection before swapping references with zero downtime.

### 4.2 Interactive Force-Directed Knowledge Graph Visualizer
- **Current Behavior**: Knowledge graph nodes and edges are accessible via JSON tool calls.
- **Suggested Feature**: An in-browser force-directed canvas allowing users and agents to visually inspect entity clusters, click nodes to view observations, filter by relationship types, and edit or prune relationships.

### 4.3 Memory Decay, Pinning, and Spaced-Repetition Weights
- **Current Behavior**: Memories remain at fixed salience indefinitely.
- **Suggested Feature**: Introduce a configurable **Half-Life / Decay Factor** where unused memories gradually decrease in score, while critical memories can be permanently "Pinned" or "Axiomatic".

### 4.4 Automated Memory Consolidation & Episodic Summarization
- **Current Behavior**: New memories are added individually.
- **Suggested Feature**: A background consolidation routine that clusters related short-term memories and generates consolidated "Episodic Milestones", reducing token consumption while preserving long-term semantic fidelity.

### 4.5 Persona Drift Detector & Alignment Guard
- **Current Behavior**: Agents track history without strict drift telemetry.
- **Suggested Feature**: A continuous cosine similarity monitor between an agent's current output patterns and its canonical persona anchor in EME. When drift exceeds a threshold, an alert or corrective memory prompt is triggered.

### 4.6 Live Semantic Memory Playground
- **Current Behavior**: Testing queries requires MCP or CLI scripts.
- **Suggested Feature**: An interactive search workbench with a real-time slider for similarity thresholds, live score badges, and graph relation overlays.

### 4.7 Universal Import & Export Hub
- **Current Behavior**: Backups are stored as raw JSON/snapshots.
- **Suggested Feature**: Direct import/export wizards for Obsidian vaults (Markdown + frontmatter), CSV, JSONL, and LangChain/Mem0 formats.

### 4.8 Sovereign Web3 Snapshot Pinning Interface
- **Current Behavior**: IPFS snapshots require CLI/Helia configuration.
- **Suggested Feature**: Built-in 1-click snapshot pinning to IPFS/Filebase with verifiable CID copy and decentralized explorer links.

---

## 5. GUI Dashboard Architecture & Extensibility Design

To ensure non-technical users can effortlessly customize, save, load, and manage EME while allowing developers to easily add future options, the frontend is built upon a **Schema-Driven Architecture**:

1. **Data-Driven Configuration Schema (`config-schema.js`)**:
   - Every setting is declared with metadata: category, label, input type, default, validation rules, description, and advanced flags.
   - **Adding a new feature to EME in the future requires only appending one object to this schema file**; the UI automatically generates the form controls, validation, presets, and serialization.

2. **Zero-Dependency Vanilla Web Stack**:
   - Built with semantic HTML5, modern CSS3 (CSS Grid/Flexbox), and vanilla ES6+ JavaScript.
   - Runs directly in mobile and desktop browsers with zero compilation or external CDN dependencies.
   - Adheres strictly to the Alsania design system: deep midnight blues (`#0b0f19`), glowing emerald green accents (`#10b981`), high-contrast typography, and fluid responsive layouts.

3. **Bidirectional Persistence**:
   - Live communication with the EME HTTP Server (`/api/config`, `/api/config/save`, `/api/config/load`, `/api/config/reset`, `/api/tools/*`).
   - Offline export/import supporting downloadable JSON configs and profile presets (e.g. "Local Solo", "Production Qdrant", "Minimal Ephemeral").

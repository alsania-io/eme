# @alsania-io/eme — Echo Memory Engine

**Sovereign Memory System for AI Agents** — Local, Encrypted, Multi-Agent Memory with MCP Protocol Support

[![npm version](https://img.shields.io/npm/v/@alsania-io/eme.svg)](https://www.npmjs.com/package/@alsania-io/eme)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol-blue)](https://spec.modelcontextprotocol.io/)

## What is EME?

Echo Memory Engine (EME) is a sovereign memory system for AI agents that provides:

- **Local & Encrypted**: Memory stays on your machine, encrypted at rest
- **MCP Protocol Native**: Fully compatible with Model Context Protocol
- **Multi-Agent Support**: Isolated namespaces for different agents
- **Semantic Search**: Vector-based memory retrieval with SQLite or Qdrant backend
- **Knowledge Graph**: Relationship tracking between memories
- **Memory Gate**: Noise filtering to prevent memory bloat
- **Configurable Embeddings**: Switch between embedding models and dimensions at runtime

## Quick Start

### Installation

```bash
npm install @alsania-io/eme
```

### Start the MCP Server

```bash
# Start EME as an MCP server
npx eme server

# Or with custom configuration
npx eme server --embeddingDimension 768 --logLevel debug
```

### Use in Your Code

```javascript
import { createMemoryManager } from '@alsania-io/eme';

// Create memory manager
const mm = await createMemoryManager({
  embeddingModel: 'local',
  embeddingDimension: 384,
  vectorStore: 'memory',    // or 'sqlite', 'qdrant'
  graphStore: 'memory',
  snapshotStore: 'filesystem',
  snapshotPath: './storage/snapshots',
  memoryGateEnabled: false,
  memoryGateThreshold: 0.3,
  maxMemoryEntries: 10000,
  similarityThreshold: 0.1,
  logLevel: 'info',
});

// Add a memory
const id = await mm.addMemory(
  'User prefers dark mode and uses a mechanical keyboard',
  'assistant-1',
  'user-preferences',
  [],
  'shared'
);

// Search memories
const results = await mm.searchMemories(
  'What keyboard does the user have?',
  5,           // limit
  'user-preferences'  // namespace (optional)
);
```

## MCP Tools

EME exposes these tools via the Model Context Protocol:

### Core Memory
| Tool | Description |
|------|-------------|
| `add_memory` | Store a new memory with embedding |
| `search_memories` | Semantic search across memories |
| `get_memory` | Retrieve a memory by ID |
| `update_memory` | Update an existing memory |
| `delete_memory` | Delete a memory by ID |

### Knowledge Graph
| Tool | Description |
|------|-------------|
| `create_entities` | Create entities in the knowledge graph |
| `create_relations` | Create relationships between entities |
| `add_observations` | Add observations to existing entities |
| `delete_entities` | Remove entities from the graph |
| `delete_relations` | Remove relationships |
| `delete_observations` | Remove specific observations |
| `read_graph` | Get the full knowledge graph |
| `search_nodes` | Search graph nodes by text |
| `open_nodes` | Retrieve specific nodes by name |
| `get_graph` | Get complete graph with stats |
| `get_graph_stats` | Get graph statistics |

### Snapshots
| Tool | Description |
|------|-------------|
| `create_snapshot` | Snapshot current state |
| `list_snapshots` | List available snapshots |
| `load_snapshot` | Restore from snapshot |
| `delete_snapshot` | Remove a snapshot |

### Configuration
| Tool | Description |
|------|-------------|
| `get_config` | Get current config (secrets redacted) |
| `update_config` | Update a config value at runtime |

### Local RAG
| Tool | Description |
|------|-------------|
| `query_documents` | Search ingested documents |
| `ingest_file` | Ingest a file for RAG |
| `ingest_data` | Ingest raw text content |
| `delete_file` | Remove an ingested file |
| `list_files` | List ingested files |
| `local_rag_status` | Get RAG system status |

### Large File Handling
| Tool | Description |
|------|-------------|
| `read_large_file_chunk` | Read a chunk of a large file |
| `search_in_large_file` | Search within a large file |
| `get_file_structure` | Analyze file structure |
| `navigate_to_line` | Jump to a specific line |
| `get_file_summary` | Get file statistics |
| `stream_large_file` | Stream file in chunks |

## Configuration

EME can be configured via:
1. **Environment variables** (highest priority)
2. **Config file** (`eme-config.json`)
3. **CLI flags**
4. **Defaults** (lowest priority)

### Embedding Models

```bash
# Use local embedding (default, 384 dimensions)
EMBEDDING_MODEL=local EMBEDDING_DIMENSION=384

# Use OpenRouter (requires API key, 2048 dimensions for Llama Nemotron)
EMBEDDING_MODEL=openrouter \
  EMBEDDING_MODEL_PATH=nvidia/llama-nemotron-embed-vl-1b-v2:free \
  EMBEDDING_DIMENSION=2048 \
  OPENROUTER_API_KEY=sk-or-v1-...
```

You can switch embedding models at runtime via the `update_config` MCP tool. The system will reinitialize all subsystems with the new configuration.

### Vector Stores

| Store | Description | Default |
|-------|-------------|---------|
| `memory` | In-memory, ephemeral | ✓ |
| `sqlite` | SQLite with persistence | |
| `qdrant` | Qdrant vector database | |

### Environment Variables

See `.env.example` for all available configuration options.

## Architecture

```
┌─────────────────────────────────────────────┐
│                 MCP Interface               │
├─────────────────────────────────────────────┤
│              Memory Manager                 │
│         (Embedding + Gate + Graph)          │
├─────────────┬──────────────┬───────────────┤
│ Vector Store│ Graph Store  │ Snapshot Store│
│ (memory/    │ (memory/     │ (filesystem/  │
│  sqlite/    │  sqlite)     │  ipfs)        │
│  qdrant)    │              │               │
└─────────────┴──────────────┴───────────────┘
```

## Build & Development

```bash
# Build
make build

# Run tests
make test

# Start server
make start

# Development (watch mode)
make dev

# Security audit
make audit

# Build Podman container
make container
```

## Security

- **Local First**: All data stays on your machine
- **No Telemetry**: No data leaves your system
- **Secret Redaction**: `get_config` never exposes API keys
- **Open Source**: MIT licensed, fully auditable

## License

MIT License — see LICENSE file for details.

---

**Made by [Alsania I/O](https://alsania.io)** — Building sovereign AI infrastructure.

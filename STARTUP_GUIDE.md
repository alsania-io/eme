# EME (Echo Memory Engine) — Startup Guide

## Quick Start

```bash
# Build the project
make build

# Start the MCP server
make start

# Or directly
node dist/index.js server
```

## Starting EME

```bash
# Standard start
npm start

# Clean start (no Node warnings)
npm run start:clean

# With custom options
node dist/index.js server --embeddingDimension 768 --logLevel debug
```

## Verifying EME Is Running

EME communicates over stdio (MCP protocol). To verify it works:

```bash
# Build and run tests
make test

# Or run the integration test directly
node -e "
const { createMemoryManager } = require('./dist/memory-manager.js');
(async () => {
  const mm = await createMemoryManager({
    embeddingModel: 'local', embeddingDimension: 384,
    vectorStore: 'memory', graphStore: 'memory',
    snapshotStore: 'filesystem', snapshotPath: './storage/snapshots',
    memoryGateEnabled: false, memoryGateThreshold: 0.3,
    maxMemoryEntries: 10000, similarityThreshold: 0.1, logLevel: 'error',
  });
  const id = await mm.addMemory('test', 'me', 'default', [], 'shared');
  const results = await mm.searchMemories('test', 5);
  console.log('EME OK — stored:', id, 'found:', results.length, 'results');
  await mm.close();
})();
"
```

## Available MCP Tools

When connected via MCP, these tools are available:

- `add_memory` — Store a new memory
- `search_memories` — Semantic search
- `get_memory` — Get memory by ID
- `update_memory` — Update a memory
- `delete_memory` — Delete a memory
- `create_entities` / `create_relations` — Knowledge graph operations
- `read_graph` / `search_nodes` / `open_nodes` — Graph queries
- `create_snapshot` / `load_snapshot` — Snapshot management
- `get_config` / `update_config` — Runtime configuration
- `query_documents` / `ingest_file` / `ingest_data` — Local RAG

## Configuration

Configure EME via:
1. Environment variables (highest priority)
2. Config file (`eme-config.json`)
3. CLI flags

See `.env.example` for all available options.

## Switching Embedding Models at Runtime

Use the `update_config` MCP tool:

```json
{
  "key": "embeddingModel",
  "value": "openrouter"
}
```

This triggers a full reinitialize of all subsystems. Dimension changes also work:

```json
{
  "key": "embeddingDimension",
  "value": 2048
}
```

## Troubleshooting

### "Cannot find module" errors
Run `make build` to compile TypeScript.

### Port/transport issues
EME uses stdio transport by default (MCP protocol). It doesn't bind to a port unless configured for HTTP.

### Dimension mismatch errors
If you change the embedding model, make sure `EMBEDDING_DIMENSION` matches the model's output dimension. Or clear the vector store first.

## Directory Structure

```
eme/
├── dist/               # Compiled output (built by `make build`)
├── src/                # TypeScript source
├── storage/            # Runtime data (databases, snapshots)
├── tests/              # Test files
├── .deprecated/        # Archived files
├── Makefile            # Build commands
├── MAKEFILE_README.md  # Makefile usage guide
├── .env.example        # Environment config template
├── Containerfile       # Podman container build
└── README.md           # Main documentation
```

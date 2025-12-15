# Alsania Echo Memory Engine (EME)

A standalone MCP server for persistent, structured AI agent memory with vector search, knowledge graphs, and memory gate filtering.

## 🚀 Features

- **Vector Memory Storage**: SQLite-based vector storage with cosine similarity search
- **Knowledge Graph Memory**: Structured graph storage for entities and relationships
- **Memory Gate Filtering**: Two-stage filtering to prevent noise
- **MCP Integration**: Full MCP protocol support with 10+ tools
- **Multi-Agent Support**: Namespace isolation and agent-specific memory
- **Snapshot System**: Time-based memory snapshots for backup/restore
- **Moderation Queue**: Shared memory approval system (Echo/Sigma only)

## 📦 Installation

```bash
cd /home/sigma/Desktop/echo-lab/memory-engine
npm install
npm run build
```

## 🛠️ Usage

### As an MCP Server

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "alsania-eme": {
      "command": "node",
      "args": ["/home/sigma/Desktop/echo-lab/memory-engine/dist/mcp-server.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

### As a Library

```typescript
import { MemoryEngine } from './dist/index.js';

const engine = new MemoryEngine();
await engine.initialize();

// Add memory
const result = await engine.addMemory(
  'User prefers dark mode and large text',
  'core-agent',
  'user-preferences',
  ['ui', 'preferences'],
  'private'
);

// Search memory
const memories = await engine.search('dark mode preferences', 5);

await engine.close();
```

## 🔧 Available MCP Tools

1. **`memory.add`** - Add new memory entry
2. **`memory.search`** - Semantic + graph hybrid search
3. **`memory.update`** - Modify existing memory
4. **`memory.delete`** - Soft delete memory
5. **`memory.list`** - List memories with filtering
6. **`memory.graph.add_node`** - Add graph node
7. **`memory.graph.add_edge`** - Add graph edge
8. **`memory.snapshot.save`** - Create snapshot
9. **`memory.snapshot.load`** - Load snapshot
10. **`memory.moderation.review`** - Moderate shared memory

## 🏗️ Architecture

### Memory Layers

1. **L1 - Ephemeral Context**: Short-term conversation window
2. **L2 - Vector Memory**: Semantic search via embeddings
3. **L3 - Knowledge Graph**: Structured entity relationships
4. **L4 - Snapshot Memory**: Time-based backups
5. **L5 - Moderated Memory**: Curated shared memory

### Storage Backend

- **Vector Store**: SQLite with cosine similarity
- **Graph Store**: SQLite with adjacency tables
- **Future**: FAISS, Qdrant, Chroma support

## 🧪 Testing

```bash
# Run basic tests
npm run test:basic

# Build and test MCP server
npm run build
npm run mcp
```

## 📁 Project Structure

```
memory-engine/
├── src/
│   ├── index.ts          # Main entry point
│   ├── types.ts          # TypeScript interfaces
│   ├── vector-store.ts   # Vector storage implementation
│   ├── graph-store.ts    # Graph storage implementation
│   ├── memory-manager.ts # Core memory orchestration
│   └── mcp-server.ts     # MCP server implementation
├── dist/                 # Compiled output
├── storage/              # Data storage directory
├── tests/                # Test files
├── package.json
├── tsconfig.json
└── README.md
```

## 🔌 Integration with Alsania Ecosystem

1. **Register with AlsaniaMCP** (port 8050)
2. **Connect to Aggregator** for multi-agent coordination
3. **Integrate with Nyx** for browser extension memory
4. **Sync with Echo-Sys** for system-wide memory

## 🚨 Memory Gate Filter

The memory gate prevents noise by:

1. **Prototype Similarity**: Check alignment with prototypes (preferences, tasks, etc.)
2. **TF-IDF Relevance**: Domain-specific relevance scoring
3. **LLM Compression**: Optional summarization before storage

## 📈 Monetization Paths

1. **Developer Product**: CLI, SDK, Docker images
2. **Hosted Service**: Alsania Memory Cloud
3. **Enterprise Licenses**: On-prem, encrypted solutions
4. **Premium Plugins**: Graph analyzers, visualizers
5. **Alsania Echo-Sys Integration**: Core memory engine

## 🐛 Known Limitations

- Local embedding model is simplistic (needs BGE-small/Instructor-xl integration)
- Graph visualization not yet implemented
- Snapshot system is basic (needs compression/encryption)
- No real LLM compression gate yet

## 🔮 Roadmap

- [ ] Integrate actual embedding models (BGE-small, Instructor-xl)
- [ ] Add FAISS vector store support
- [ ] Implement IPFS snapshot storage
- [ ] Add graph visualization API
- [ ] Implement reverse proxy mode
- [ ] Add encryption for sensitive memories
- [ ] Create web dashboard

## 📄 License

MIT - Part of the Alsania Ecosystem

## 👥 Authors

- **Sigma** - Architecture & Core Design
- **Echo** - Memory Systems & Integration
- **Aegis** - Strategic Development
- **DeepSeek (via Nyx)** - Initial Implementation

## 🤝 Collaboration

This is part of the **Alsania Emergency Collaboration Initiative**. Built in parallel with Aegis working on GChat integration and task assignment systems.
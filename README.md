# @alsania-io/eme - Echo Memory Engine

**Sovereign Memory System for AI Agents** - Local, Encrypted, Multi-Agent Memory with MCP Protocol Support

[![npm version](https://img.shields.io/npm/v/@alsania-io/eme.svg)](https://www.npmjs.com/package/@alsania-io/eme)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol-blue)](https://spec.modelcontextprotocol.io/)

## 🎯 What is EME?

Echo Memory Engine (EME) is a sovereign memory system for AI agents that provides:

- **Local & Encrypted**: Your memory stays on your machine, encrypted at rest
- **MCP Protocol Native**: Fully compatible with Model Context Protocol
- **Multi-Agent Support**: Isolated namespaces for different agents
- **Semantic Search**: Vector-based memory retrieval with SQLite backend
- **Knowledge Graph**: Relationship tracking between memories
- **Memory Gate**: Noise filtering to prevent memory bloat

## 🚀 Quick Start

### Installation

```bash
npm install @alsania-io/eme
# or
yarn add @alsania-io/eme
# or
pnpm add @alsania-io/eme
```

### Start the MCP Server

```bash
# Start EME as an MCP server
npx eme start

# Or with specific configuration
npx eme start --port 3636 --maxMemoryEntries 10000
```

### Use in Your Code

```javascript
import { MemoryEngine } from '@alsania-io/eme';

// Initialize the memory engine
const memory = new MemoryEngine({
  vectorStorePath: './storage/vectors.db',
  graphStorePath: './storage/graph.jsonl',
  snapshotPath: './storage/snapshots'
});

await memory.initialize();

// Add a memory
const result = await memory.addMemory(
  'User prefers dark mode and uses a mechanical keyboard',
  'assistant-1',
  'user-preferences'
);

// Search memories
const memories = await memory.search(
  'What keyboard does the user have?',
  5, // limit
  'user-preferences' // namespace (optional)
);
```

## 📖 Documentation

### MCP Tools

EME provides the following MCP tools:

- `add_memory` - Add a new memory entry
- `search_memory` - Search memories using semantic and graph search
- `update_memory` - Update an existing memory entry
- `delete_memory` - Delete a memory entry (soft delete)
- `list_memories` - List memories with optional filtering
- `graph_add_node` - Add a node to the knowledge graph
- `graph_add_edge` - Add an edge between graph nodes
- `snapshot_save` - Create a memory snapshot
- `snapshot_load` - Load a memory snapshot
- `graph_read` - Read entire graph structure with nodes and edges
- `batch_add_memories` - Add multiple memories at once
- `clear_namespace` - Clear all nodes and edges in a namespace

### Configuration

EME can be configured via constructor options or environment variables:

```javascript
const config = {
  // Embedding configuration
  embeddingModel: 'local',           // or 'openai', 'cohere', etc.
  embeddingDimension: 384,           // BGE-small dimension
  
  // Storage configuration
  vectorStore: 'sqlite',             // or 'postgres', 'memory'
  vectorStorePath: './storage/vectors.db',
  graphStore: 'jsonl',               // or 'neo4j', 'memory'
  graphStorePath: './storage/graph.jsonl',
  snapshotStore: 'filesystem',       // or 's3', 'ipfs'
  snapshotPath: './storage/snapshots',
  
  // Memory gate configuration
  memoryGateEnabled: true,
  memoryGateThreshold: 0.3,
  
  // General configuration
  maxMemoryEntries: 10000,
  similarityThreshold: 0.3,
  logLevel: 'info'                   // 'debug', 'info', 'warn', 'error'
};
```

### CLI Usage

```bash
# Start MCP server
npx eme start

# Start with specific port
npx eme start --port 3636

# Show configuration
npx eme config

# Show version
npx eme version

# Run tests
npx eme test

# Get help
npx eme help
```

## 🔧 Architecture

EME is built with a modular architecture:

```
┌─────────────────────────────────────────────┐
│                 MCP Interface               │
├─────────────────────────────────────────────┤
│              Memory Manager                 │
├─────────────┬──────────────┬───────────────┤
│ Vector Store│ Graph Store  │ Snapshot Store│
│  (SQLite)   │   (JSONL)    │  (Filesystem) │
└─────────────┴──────────────┴───────────────┘
│              Memory Gate                    │
│         (Noise Filtering)                   │
└─────────────────────────────────────────────┘
```

### Key Features

1. **Vector Memory Store**: SQLite-based vector storage for semantic search
2. **Knowledge Graph**: Track relationships between memories
3. **Memory Gate**: Prevent memory bloat with relevance filtering
4. **Snapshot System**: Version and export/import memory states
5. **Multi-Namespace**: Isolate memories by agent or context
6. **Encryption**: All data encrypted at rest with local keys

## 🔐 Security & Privacy

- **Local First**: All data stays on your machine
- **Encryption**: Memories encrypted with AES-256
- **No Telemetry**: No data leaves your system
- **Open Source**: MIT licensed, fully auditable

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for the [Model Context Protocol](https://spec.modelcontextprotocol.io/) ecosystem
- Inspired by the need for sovereign AI memory systems
- Thanks to all contributors and the open source community

## 📞 Support

- [GitHub Issues](https://github.com/alsania-io/eme/issues) for bug reports and feature requests
- [Documentation](https://github.com/alsania-io/eme#readme) for usage guides
- [Discussions](https://github.com/alsania-io/eme/discussions) for questions and community support

---

**Made with ❤️ by [Alsania I/O](https://alsania.io) - Building sovereign AI infrastructure.**

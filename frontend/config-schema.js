/**
 * Echo Memory Engine (EME) - Configuration Schema & Presets
 * 
 * TO ADD NEW FEATURES IN THE FUTURE:
 * Simply append or edit a field in the `CONFIG_FIELDS` array below.
 * The GUI dashboard will automatically render the input control, validation,
 * tooltips, and serialization without requiring changes to HTML or CSS.
 */

export const CONFIG_CATEGORIES = [
  {
    id: 'overview',
    label: 'Overview',
    icon: '📊',
    description: 'System health, quick statistics, and one-click configuration profiles.'
  },
  {
    id: 'models',
    label: 'AI & Embeddings',
    icon: '🧠',
    description: 'Configure vector embedding models, dimension sizes, and model providers.'
  },
  {
    id: 'storage',
    label: 'Vector Stores',
    icon: '💾',
    description: 'Configure how and where memory vectors are indexed and stored.'
  },
  {
    id: 'gate',
    label: 'Memory Gate',
    icon: '🛡️',
    description: 'Intelligent noise filtering, salience thresholds, and memory capacity limits.'
  },
  {
    id: 'graph',
    label: 'Knowledge Graph',
    icon: '🕸️',
    description: 'Structured relationship tracking between entities, tasks, and agents.'
  },
  {
    id: 'snapshots',
    label: 'Snapshots & Backup',
    icon: '📦',
    description: 'Portable archives, filesystem backups, and decentralized IPFS pinning.'
  },
  {
    id: 'system',
    label: 'System & Security',
    icon: '⚙️',
    description: 'AES encryption keys, logging verbosity, and developer debugging.'
  },
  {
    id: 'playground',
    label: 'Live Test Bench',
    icon: '🧪',
    description: 'Test memory recall, add sample memories, and run system diagnostic checks.'
  },
  {
    id: 'raw',
    label: 'Raw JSON',
    icon: '📝',
    description: 'Direct JSON configuration editor with syntax validation.'
  }
];

export const CONFIG_FIELDS = [
  // AI & Embeddings
  {
    key: 'embeddingModel',
    category: 'models',
    label: 'Primary Embedding Model',
    type: 'select',
    default: 'local',
    options: [
      { value: 'local', label: 'Local (Zero Setup, 384-dim, Fast on CPU)' },
      { value: 'openrouter', label: 'OpenRouter (Llama Nemotron, 2048-dim, High Accuracy)' },
      { value: 'openai', label: 'OpenAI (text-embedding-3-small/large)' },
      { value: 'cohere', label: 'Cohere (embed-english-v3.0)' },
      { value: 'huggingface', label: 'HuggingFace (Custom Endpoint/Transformers)' }
    ],
    description: 'The embedding provider used to convert texts into semantic vector coordinates.',
    advanced: false
  },
  {
    key: 'embeddingDimension',
    category: 'models',
    label: 'Embedding Dimension',
    type: 'number',
    default: 384,
    min: 32,
    max: 8192,
    step: 1,
    description: 'Dimensionality of the vector space. E.g., 384 for local, 1536 for OpenAI, 2048 for OpenRouter Nemotron.',
    advanced: false
  },
  {
    key: 'embeddingModelPath',
    category: 'models',
    label: 'Model Path or Remote Model ID',
    type: 'text',
    default: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    placeholder: 'e.g., nvidia/llama-nemotron-embed-vl-1b-v2:free',
    description: 'Specific HuggingFace model path or OpenRouter model slug.',
    advanced: false
  },
  {
    key: 'openRouterApiKey',
    category: 'models',
    label: 'OpenRouter API Key',
    type: 'password',
    default: '',
    placeholder: 'sk-or-v1-...',
    description: 'Required only when using OpenRouter as embedding provider.',
    advanced: false
  },
  {
    key: 'openRouterReferer',
    category: 'models',
    label: 'OpenRouter App Referer URL',
    type: 'text',
    default: 'https://alsania-io.com',
    description: 'Site attribution URL for OpenRouter dashboard statistics.',
    advanced: true
  },
  {
    key: 'openRouterTitle',
    category: 'models',
    label: 'OpenRouter App Title',
    type: 'text',
    default: 'Echo Memory Engine',
    description: 'Human-readable title displayed on OpenRouter usage reports.',
    advanced: true
  },
  {
    key: 'fallbackEmbeddingModel',
    category: 'models',
    label: 'Fallback Embedding Model',
    type: 'select',
    default: 'local',
    options: [
      { value: 'local', label: 'Local (On-Device Fallback)' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'cohere', label: 'Cohere' }
    ],
    description: 'Automatic backup embedding model if the primary network call fails.',
    advanced: true
  },
  {
    key: 'fallbackEmbeddingDimension',
    category: 'models',
    label: 'Fallback Embedding Dimension',
    type: 'number',
    default: 384,
    description: 'Dimensions expected by the fallback embedding model.',
    advanced: true
  },
  // Vector Storage
  {
    key: 'vectorStore',
    category: 'storage',
    label: 'Vector Database Engine',
    type: 'select',
    default: 'qdrant',
    options: [
      { value: 'memory', label: 'In-Memory (Ephemeral, Clears on Restart)' },
      { value: 'sqlite', label: 'SQLite (Local File, Zero Config, Persistent)' },
      { value: 'qdrant', label: 'Qdrant (High Performance, Scalable Vector DB)' },
      { value: 'postgres', label: 'PostgreSQL with pgvector (Enterprise)' },
      { value: 'lancedb', label: 'LanceDB (Columnar File Vector Store)' },
      { value: 'faiss', label: 'FAISS (Facebook AI Similarity Search)' }
    ],
    description: 'Underlying database engine used to index and retrieve memory embeddings.',
    advanced: false
  },
  {
    key: 'vectorStorePath',
    category: 'storage',
    label: 'Vector Database File Path',
    type: 'text',
    default: './storage/vectors.db',
    placeholder: './storage/vectors.db',
    description: 'Path for local SQLite or LanceDB vector storage files.',
    advanced: false
  },
  {
    key: 'qdrantUrl',
    category: 'storage',
    label: 'Qdrant Server URL',
    type: 'text',
    default: 'http://localhost:6333',
    placeholder: 'http://localhost:6333',
    description: 'HTTP endpoint for the Qdrant instance.',
    advanced: false
  },
  {
    key: 'qdrantCollection',
    category: 'storage',
    label: 'Qdrant Collection Name',
    type: 'text',
    default: 'am2',
    placeholder: 'am2',
    description: 'Vector collection identifier in Qdrant.',
    advanced: false
  },
  {
    key: 'qdrantVectorName',
    category: 'storage',
    label: 'Named Vector Slot',
    type: 'text',
    default: 'v2048',
    placeholder: 'e.g., v2048 (or leave empty for single-vector)',
    description: 'Named vector partition for multi-vector Qdrant schemas.',
    advanced: true
  },
  {
    key: 'postgresConnection',
    category: 'storage',
    label: 'PostgreSQL Connection URI',
    type: 'password',
    default: '',
    placeholder: 'postgresql://user:pass@localhost:5432/eme',
    description: 'Used when PostgreSQL vector store is selected.',
    advanced: true
  },
  // Memory Gate & Noise Control
  {
    key: 'memoryGateEnabled',
    category: 'gate',
    label: 'Enable Intelligent Memory Gate',
    type: 'toggle',
    default: true,
    description: 'Filters out low-salience banter, spam, and repetitive statements before saving.',
    advanced: false
  },
  {
    key: 'memoryGateThreshold',
    category: 'gate',
    label: 'Gate Salience Sensitivity',
    type: 'slider',
    default: 0.3,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: 'Minimum relevance required to save a memory. Higher values = stricter filtering.',
    advanced: false
  },
  {
    key: 'similarityThreshold',
    category: 'gate',
    label: 'Recall Similarity Cutoff',
    type: 'slider',
    default: 0.3,
    min: 0.0,
    max: 1.0,
    step: 0.05,
    description: 'Cosine similarity threshold for search recall. Higher = only exact semantic matches.',
    advanced: false
  },
  {
    key: 'maxMemoryEntries',
    category: 'gate',
    label: 'Maximum Memory Capacity',
    type: 'number',
    default: 10000,
    min: 100,
    max: 1000000,
    step: 500,
    description: 'Upper boundary of active memories maintained before capacity warning triggers.',
    advanced: false
  },
  // Knowledge Graph
  {
    key: 'graphStore',
    category: 'graph',
    label: 'Knowledge Graph Storage',
    type: 'select',
    default: 'memory',
    options: [
      { value: 'memory', label: 'In-Memory (Fast, Ephemeral)' },
      { value: 'sqlite', label: 'SQLite (Persistent Local Graph DB)' },
      { value: 'jsonl', label: 'JSON Lines (Human Inspectable Log)' }
    ],
    description: 'Storage backend for entity relationships, tasks, and semantic facts.',
    advanced: false
  },
  {
    key: 'graphStorePath',
    category: 'graph',
    label: 'Graph Database File Path',
    type: 'text',
    default: './storage/graph.db',
    placeholder: './storage/graph.db',
    description: 'Filesystem location for SQLite/JSONL graph data.',
    advanced: false
  },
  // Snapshots & Backup
  {
    key: 'snapshotStore',
    category: 'snapshots',
    label: 'Snapshot Storage Target',
    type: 'select',
    default: 'filesystem',
    options: [
      { value: 'filesystem', label: 'Local Filesystem (Archive Bundles)' },
      { value: 'ipfs', label: 'IPFS / Helia (Decentralized Web3 Pinning)' },
      { value: 'filebase', label: 'Filebase (Geo-redundant IPFS S3)' },
      { value: 's3', label: 'AWS S3 or MinIO Bucket' }
    ],
    description: 'Target storage provider where state snapshots are archived.',
    advanced: false
  },
  {
    key: 'snapshotPath',
    category: 'snapshots',
    label: 'Snapshot Directory Path',
    type: 'text',
    default: './storage/snapshots',
    placeholder: './storage/snapshots',
    description: 'Local directory path where snapshot bundles and manifests are kept.',
    advanced: false
  },
  // System & Security
  {
    key: 'encryptionKey',
    category: 'system',
    label: 'At-Rest AES Encryption Key',
    type: 'password',
    default: '',
    placeholder: 'Leave blank to use unencrypted local storage',
    description: 'Cryptographic key used to encrypt memory texts stored at rest on disk.',
    advanced: false
  },
  {
    key: 'logLevel',
    category: 'system',
    label: 'Diagnostic Log Level',
    type: 'select',
    default: 'info',
    options: [
      { value: 'debug', label: 'Debug (Verbose internal execution trace)' },
      { value: 'info', label: 'Info (Normal operational logs)' },
      { value: 'warn', label: 'Warn (Warnings and errors only)' },
      { value: 'error', label: 'Error (Failures only)' }
    ],
    description: 'Controls verbosity of console and file logging output.',
    advanced: false
  },
  {
    key: 'development',
    category: 'system',
    label: 'Development Mode',
    type: 'toggle',
    default: false,
    description: 'Enables hot reloads, uncompressed stack traces, and test mocks.',
    advanced: true
  }
];

export const CONFIG_PRESETS = [
  {
    id: 'local_solo',
    title: '🟢 Local Solo (Zero Setup)',
    badge: 'Beginner Friendly',
    description: '100% on-device and offline. Zero API keys, zero external database setup needed. Perfect for first-time users.',
    config: {
      embeddingModel: 'local',
      embeddingDimension: 384,
      fallbackEmbeddingModel: 'local',
      fallbackEmbeddingDimension: 384,
      vectorStore: 'sqlite',
      vectorStorePath: './storage/vectors.db',
      graphStore: 'sqlite',
      graphStorePath: './storage/graph.db',
      snapshotStore: 'filesystem',
      snapshotPath: './storage/snapshots',
      memoryGateEnabled: true,
      memoryGateThreshold: 0.3,
      similarityThreshold: 0.3,
      maxMemoryEntries: 10000,
      logLevel: 'info',
      development: false
    }
  },
  {
    id: 'qdrant_openrouter',
    title: '⚡ Production High-Accuracy (Qdrant + OpenRouter)',
    badge: 'Alsania Standard',
    description: 'High-performance vector retrieval with 2048-dim Llama Nemotron embeddings and Qdrant database.',
    config: {
      embeddingModel: 'openrouter',
      embeddingModelPath: 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
      embeddingDimension: 2048,
      fallbackEmbeddingModel: 'local',
      fallbackEmbeddingDimension: 384,
      vectorStore: 'qdrant',
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'am2',
      qdrantVectorName: 'v2048',
      graphStore: 'memory',
      snapshotStore: 'filesystem',
      snapshotPath: './storage/snapshots',
      memoryGateEnabled: true,
      memoryGateThreshold: 0.3,
      similarityThreshold: 0.3,
      maxMemoryEntries: 25000,
      logLevel: 'info',
      development: true
    }
  },
  {
    id: 'low_end_device',
    title: '🍃 Ultra-Lightweight (Low RAM / Raspberry Pi)',
    badge: 'Resource Saver',
    description: 'Minimal memory footprint. Uses local 384-dim vectors, strict noise gating, and in-memory indices.',
    config: {
      embeddingModel: 'local',
      embeddingDimension: 384,
      fallbackEmbeddingModel: 'local',
      fallbackEmbeddingDimension: 384,
      vectorStore: 'memory',
      graphStore: 'memory',
      snapshotStore: 'filesystem',
      snapshotPath: './storage/snapshots',
      memoryGateEnabled: true,
      memoryGateThreshold: 0.4,
      similarityThreshold: 0.35,
      maxMemoryEntries: 3000,
      logLevel: 'warn',
      development: false
    }
  },
  {
    id: 'sovereign_web3',
    title: '🌐 Sovereign Web3 (IPFS + Pinning)',
    badge: 'Decentralized',
    description: 'Persists decentralized snapshots to IPFS with verifiable CIDs and multi-agent sharing.',
    config: {
      embeddingModel: 'local',
      embeddingDimension: 384,
      vectorStore: 'sqlite',
      vectorStorePath: './storage/vectors.db',
      graphStore: 'sqlite',
      graphStorePath: './storage/graph.db',
      snapshotStore: 'ipfs',
      snapshotPath: './storage/snapshots',
      memoryGateEnabled: true,
      memoryGateThreshold: 0.3,
      similarityThreshold: 0.3,
      maxMemoryEntries: 10000,
      logLevel: 'info',
      development: false
    }
  }
];

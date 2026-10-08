import { createMemoryManager, MemoryManager } from '../src/memory-manager.js';
import { loadConfig, validateConfig } from '../src/config-loader.js';
import type { Config } from '../src/types.js';

/**
 * Test config using in-memory stores (no external dependencies needed)
 */
function makeTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    embeddingModel: 'local',
    embeddingDimension: 384,
    vectorStore: 'memory',
    graphStore: 'memory',
    snapshotStore: 'filesystem',
    snapshotPath: './storage/snapshots',
    memoryGateEnabled: false,
    memoryGateThreshold: 0.3,
    maxMemoryEntries: 10000,
    similarityThreshold: 0.1,
    logLevel: 'error',
    ...overrides,
  };
}

describe('EME — Echo Memory Engine', () => {
  let mm: MemoryManager;

  afterEach(async () => {
    if (mm) {
      await mm.close();
    }
  });

  describe('MemoryManager', () => {
    it('should create with local embedding and in-memory stores', async () => {
      mm = await createMemoryManager(makeTestConfig());
      expect(mm).toBeDefined();
    });

    it('should add a memory and retrieve it by ID', async () => {
      mm = await createMemoryManager(makeTestConfig());
      const id = await mm.addMemory('Test memory about sovereignty', 'sigma', 'test', ['tag1'], 'shared');
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const mem = await mm.getMemory(id);
      expect(mem).not.toBeNull();
      expect(mem!.text).toBe('Test memory about sovereignty');
      expect(mem!.embedding.length).toBe(0); // stripEmbedding token-lean boundary policy
    });

    it('should search memories by semantic similarity', async () => {
      mm = await createMemoryManager(makeTestConfig());
      await mm.addMemory('The user loves dark mode themes', 'sigma', 'prefs', [], 'shared');
      await mm.addMemory('Mechanical keyboard preference noted', 'sigma', 'prefs', [], 'shared');
      await mm.addMemory('Favorite color is blue', 'sigma', 'prefs', [], 'shared');

      const results = await mm.searchMemories('dark theme mode', 5, 'prefs');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should delete a memory', async () => {
      mm = await createMemoryManager(makeTestConfig());
      const id = await mm.addMemory('Temporary memory', 'test', 'del-test', [], 'shared');
      await mm.deleteMemory(id);
      const mem = await mm.getMemory(id);
      expect(mem).toBeNull();
    });
  });

  describe('Dimension switching via reinitialize()', () => {
    it('should allow switching embedding dimensions', async () => {
      mm = await createMemoryManager(makeTestConfig({ embeddingDimension: 256 }));
      const emb1 = await mm.embed('Memory at 256 dim');
      expect(emb1.length).toBe(256);

      // Reinitialize to 512 dimensions
      await mm.reinitialize(makeTestConfig({ embeddingDimension: 512 }));
      const emb2 = await mm.embed('Memory at 512 dim');
      expect(emb2.length).toBe(512);
    });

    it('should search correctly after dimension change', async () => {
      mm = await createMemoryManager(makeTestConfig({ embeddingDimension: 128 }));
      await mm.reinitialize(makeTestConfig({ embeddingDimension: 512 }));
      await mm.addMemory('Post-reinitialize memory about testing', 'test', 'reinit', [], 'shared');

      const results = await mm.searchMemories('testing', 5, 'reinit');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe('Graph operations', () => {
    it('should create entities and query the graph', async () => {
      mm = await createMemoryManager(makeTestConfig());
      const entities = await mm.createEntities([
        { name: 'Sigma', entityType: 'person', observations: ['founder'] },
        { name: 'Echo', entityType: 'person', observations: ['co-leader'] },
      ]);
      expect(entities.length).toBe(2);

      const graph = await mm.getGraph();
      expect(graph.nodes.length).toBeGreaterThanOrEqual(2);

      const stats = await mm.getGraphStats();
      expect(stats.totalNodes).toBeGreaterThanOrEqual(2);
    });

    it('should search nodes by name', async () => {
      mm = await createMemoryManager(makeTestConfig());
      await mm.createEntities([
        { name: 'AlphaNode', entityType: 'concept' },
        { name: 'BetaNode', entityType: 'concept' },
      ]);

      const results = await mm.searchNodes('Alpha');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('AlphaNode');
    });
  });

  describe('Snapshots', () => {
    it('should create and list snapshots', async () => {
      mm = await createMemoryManager(makeTestConfig());
      await mm.addMemory('Snapshot test memory', 'test', 'snap', [], 'shared');

      const snapshot = await mm.createSnapshot('test-snap', 'full', 'Test snapshot');
      expect(snapshot.id).toBeDefined();

      const list = await mm.listSnapshots();
      expect(list.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Embed function exposure', () => {
    it('should expose embed() for external consumers', async () => {
      mm = await createMemoryManager(makeTestConfig());
      const embedding = await mm.embed('test text');
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384);
    });
  });
});

describe('Config System', () => {
  it('should validate bad config and return warnings', () => {
    const warnings = validateConfig({
      embeddingModel: 'nonexistent' as any,
      embeddingDimension: -1,
      vectorStore: 'memory',
      graphStore: 'memory',
      snapshotStore: 'filesystem',
      memoryGateEnabled: true,
      memoryGateThreshold: 2.0,
      maxMemoryEntries: 10000,
      similarityThreshold: 0.3,
      logLevel: 'info',
    });
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('should validate good config and return no warnings', () => {
    const warnings = validateConfig(makeTestConfig());
    expect(warnings.length).toBe(0);
  });

  it('should load config from environment variables', () => {
    process.env.EMBEDDING_DIMENSION = '768';
    const config = loadConfig();
    expect(config.embeddingDimension).toBe(768);
    delete process.env.EMBEDDING_DIMENSION;
  });
});

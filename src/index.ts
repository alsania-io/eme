import type { Config, MemoryGateFilter, SearchResult } from './types.js';
import { createMemoryManager } from './memory-manager.js';
import { EMEMCPServer } from './mcp-server.js';

export { MemoryManager, createMemoryManager } from './memory-manager.js';
export { SQLiteVectorStore, createVectorStore } from './vector-store.js';
export { SQLiteGraphStore, createGraphStore } from './graph-store.js';
export type {
  MemoryEntry,
  GraphNode,
  GraphEdge,
  SearchResult,
  MemoryGateFilter,
  Config,
} from './types.js';

export { EMEMCPServer } from './mcp-server.js';

// Default configuration
export const defaultConfig: Config = {
  embeddingModel: 'local',
  vectorStore: 'sqlite',
  graphEnabled: true,
  snapshotPath: './storage/snapshots',
  maxMemoryEntries: 10000,
  similarityThreshold: 0.3,
};

// Utility function to create and start MCP server
export async function startMCPServer(): Promise<void> {
  const server = new EMEMCPServer();
  await server.start();
}

// For backward compatibility with existing Python code
export class MemoryEngine {
  private manager: ReturnType<typeof createMemoryManager>;

  constructor(config?: Partial<Config>) {
    const fullConfig = { ...defaultConfig, ...config };
    this.manager = createMemoryManager(fullConfig);
  }

  async initialize(): Promise<void> {
    await this.manager.initialize();
  }

  async addMemory(
    text: string,
    agentId: string = 'unknown',
    namespace: string = 'default',
    tags: string[] = [],
    visibility: 'private' | 'shared' | 'system' = 'private',
    forceSave: boolean = false
  ): Promise<{id: string | null, filter: MemoryGateFilter}> {
    return await this.manager.addMemory(text, agentId, namespace, tags, visibility, forceSave);
  }

  async search(
    query: string,
    limit: number = 5,
    namespace?: string,
    includeGraph: boolean = true
  ): Promise<SearchResult[]> {
    return await this.manager.search(query, limit, namespace, includeGraph);
  }

  async close(): Promise<void> {
    await this.manager.close();
  }
}

// CLI support
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'start':
      startMCPServer().catch(console.error);
      break;
    case 'test':
      // Run basic tests
      (async () => {
        const engine = new MemoryEngine();
        await engine.initialize();
        
        const result = await engine.addMemory('Test memory from CLI', 'cli-test');
        console.log('Added memory:', result);
        
        const searchResults = await engine.search('test memory');
        console.log('Search results:', searchResults);
        
        await engine.close();
        console.log('Test completed');
      })().catch(console.error);
      break;
    default:
      console.log(`
Alsania Echo Memory Engine (EME) - v0.1.0

Commands:
  start    - Start MCP server
  test     - Run basic tests

Usage:
  node dist/index.js [command]
      `);
      break;
  }
}
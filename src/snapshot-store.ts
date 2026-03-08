import { Config, ISnapshotStore, SnapshotMetadata } from "./types.js";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import crypto from "crypto";
import { IPFSSnapshotStore, createIPFSStore } from "./ipfs-store.js";

// Filesystem snapshot store implementation
class FilesystemSnapshotStore implements ISnapshotStore {
  private basePath: string;
  private initialized: boolean = false;
  private snapshots: Map<string, SnapshotMetadata> = new Map();
  private indexPath: string;

  constructor(config: Config) {
    if (!config.snapshotPath) {
      throw new Error("snapshotPath required for filesystem snapshot store");
    }
    this.basePath = config.snapshotPath;
    this.indexPath = path.join(this.basePath, "snapshots.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.basePath, { recursive: true });

      // Load existing index if it exists
      try {
        const indexData = await fs.readFile(this.indexPath, "utf-8");
        const parsed = JSON.parse(indexData);
        Object.entries(parsed).forEach(([key, value]) => {
          this.snapshots.set(key, value as SnapshotMetadata);
        });
        console.log(
          `[Filesystem] Loaded ${this.snapshots.size} snapshots from ${this.indexPath}`,
        );
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          console.warn(`[Filesystem] Error loading index: ${err.message}`);
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error("[Filesystem] Failed to initialize:", error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async saveIndex(): Promise<void> {
    const indexObj = Object.fromEntries(this.snapshots);
    await fs.writeFile(this.indexPath, JSON.stringify(indexObj, null, 2));
  }

  private generateChecksum(data: any): string {
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify(data));
    return hash.digest("hex");
  }

  async saveSnapshot(
    name: string,
    data: any,
    type: "memory" | "graph" | "full" = "full",
    description?: string,
    metadata?: Record<string, any>,
  ): Promise<{ id: string; cid?: string; size: number }> {
    await this.ensureInitialized();

    const id = randomUUID();
    const timestamp = Date.now();
    const size = JSON.stringify(data).length;
    const checksum = this.generateChecksum(data);

    // Save snapshot file
    const snapshotPath = path.join(this.basePath, `${id}.json`);
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          id,
          name,
          description,
          timestamp,
          data,
          metadata,
          checksum,
        },
        null,
        2,
      ),
    );

    // Update index
    this.snapshots.set(id, {
      id,
      name,
      description,
      timestamp,
      size,
      type,
    });

    await this.saveIndex();

    console.log(`[Filesystem] Saved snapshot "${name}" as ${snapshotPath}`);
    return { id, size };
  }

  async loadSnapshot(id: string): Promise<any | null> {
    await this.ensureInitialized();

    const snapshotPath = path.join(this.basePath, `${id}.json`);
    try {
      const data = await fs.readFile(snapshotPath, "utf-8");
      const parsed = JSON.parse(data);

      // Verify checksum if present
      if (parsed.checksum) {
        const currentChecksum = this.generateChecksum(parsed.data);
        if (currentChecksum !== parsed.checksum) {
          console.warn(`[Filesystem] Checksum mismatch for snapshot ${id}`);
        }
      }

      return parsed;
    } catch (error) {
      console.error(`[Filesystem] Failed to load snapshot ${id}:`, error);
      return null;
    }
  }

  async listSnapshots(
    type?: "memory" | "graph" | "full",
  ): Promise<SnapshotMetadata[]> {
    await this.ensureInitialized();

    const snapshots = Array.from(this.snapshots.values());
    if (type) {
      return snapshots.filter((s) => s.type === type);
    }
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const snapshotPath = path.join(this.basePath, `${id}.json`);
    try {
      await fs.unlink(snapshotPath);
      const existed = this.snapshots.delete(id);
      if (existed) {
        await this.saveIndex();
      }
      return existed;
    } catch (error) {
      console.error(`[Filesystem] Failed to delete snapshot ${id}:`, error);
      return false;
    }
  }

  async getStats(): Promise<{
    snapshotCount: number;
    totalSize: number;
    [key: string]: any;
  }> {
    await this.ensureInitialized();

    const snapshotCount = this.snapshots.size;
    const totalSize = Array.from(this.snapshots.values()).reduce(
      (sum, s) => sum + s.size,
      0,
    );

    return {
      snapshotCount,
      totalSize,
      store: "filesystem",
      path: this.basePath,
    };
  }

  async close(): Promise<void> {
    // Nothing to close for filesystem
  }
}

// Factory function to create snapshot store
export async function createSnapshotStore(
  config: Config,
): Promise<ISnapshotStore> {
  console.log(`[Snapshot] Creating ${config.snapshotStore} snapshot store`);

  switch (config.snapshotStore) {
    case "filesystem":
      return new FilesystemSnapshotStore(config);

    case "ipfs":
    case "filebase": // Filebase is IPFS-compatible
      const ipfsStore = new IPFSSnapshotStore(config);
      await ipfsStore.initialize();
      return ipfsStore;

    case "drive":
    case "s3":
      throw new Error(
        `Snapshot store ${config.snapshotStore} not yet implemented`,
      );

    default:
      throw new Error(`Unknown snapshot store: ${config.snapshotStore}`);
  }
}

// Re-export IPFS store and ISnapshotStore
export { IPFSSnapshotStore, createIPFSStore } from "./ipfs-store.js";
export type { ISnapshotStore };

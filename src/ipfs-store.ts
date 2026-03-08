import type { CID } from "multiformats/cid";
import type { PeerId } from "@libp2p/interface";
import type { Config, IPFSConfig, SnapshotMetadata } from "./types.js";

interface Snapshot {
  id: string;
  name: string;
  description?: string;
  timestamp: number;
  data: any;
  metadata?: Record<string, any>;
}

export class IPFSSnapshotStore {
  private helia: any | null = null;
  private fs: any | null = null;
  private dag: any | null = null;
  private ipnsClient: any | null = null;
  private initialized: boolean = false;
  private snapshotsIndex: Map<string, SnapshotMetadata> = new Map();
  private config: Config & { snapshotConfig?: IPFSConfig };
  private readonly INDEX_KEY = "eme-snapshots-index";

  constructor(config: Config) {
    this.config = config as Config & { snapshotConfig?: IPFSConfig };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamically import Helia modules
      const [heliaModule, unixfsModule, dagCborModule, ipnsModule] =
        await Promise.all([
          import("helia"),
          import("@helia/unixfs"),
          import("@helia/dag-cbor"),
          import("@helia/ipns"),
        ]);

      const { createHelia } = heliaModule;
      const { unixfs } = unixfsModule;
      const { dagCbor } = dagCborModule;
      const { ipns } = ipnsModule;

      // Get IPFS config from snapshotConfig
      const ipfsConfig = this.config.snapshotConfig || {};

      // Initialize Helia with custom config if provided
      const heliaConfig: any = {
        start: true,
        ...(ipfsConfig.heliaConfig || {}),
      };

      // If we have an IPFS gateway endpoint, use it as a delegated routing
      if (ipfsConfig.ipfsGateway) {
        heliaConfig.delegatedRouting = [
          {
            endpoint: new URL(ipfsConfig.ipfsGateway),
            token: ipfsConfig.ipfsToken,
          },
        ];
      }

      this.helia = await createHelia(heliaConfig);
      this.fs = unixfs(this.helia);
      this.dag = dagCbor(this.helia);
      this.ipnsClient = ipns(this.helia);

      // Load existing snapshots index from IPNS or DHT
      await this.loadIndex();

      this.initialized = true;
      console.log(
        `[IPFS] Helia initialized with peer ID: ${this.helia.libp2p.peerId.toString()}`,
      );
    } catch (error) {
      console.error("[IPFS] Failed to initialize Helia:", error);
      throw error;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async loadIndex(): Promise<void> {
    try {
      // Get namespace from snapshotConfig
      const ipfsConfig = this.config.snapshotConfig || {};
      const namespace = ipfsConfig.namespace || "default";
      const ipnsName = `eme-snapshots-${namespace}`;

      // Try to resolve from IPNS first
      const result = await this.ipnsClient!.resolve(ipnsName).catch(() => null);

      if (result && result.cid) {
        // Load index from the resolved CID
        const indexData = await this.dag!.get(result.cid);
        if (indexData && typeof indexData === "object") {
          const index = indexData as Record<string, SnapshotMetadata>;
          Object.entries(index).forEach(([key, value]) => {
            this.snapshotsIndex.set(key, value);
          });
          console.log(
            `[IPFS] Loaded ${this.snapshotsIndex.size} snapshots from index`,
          );
        }
      }
    } catch (error) {
      // No existing index, start fresh
      console.log("[IPFS] No existing snapshot index found, starting fresh");
    }
  }

  private async saveIndex(): Promise<void> {
    const indexObj = Object.fromEntries(this.snapshotsIndex);

    // Store index as DAG-CBOR
    const indexCid = await this.dag!.add(indexObj);

    // Get namespace from snapshotConfig
    const ipfsConfig = this.config.snapshotConfig || {};
    const namespace = ipfsConfig.namespace || "default";
    const ipnsName = `eme-snapshots-${namespace}`;
    await this.ipnsClient!.publish(ipnsName, indexCid);

    console.log(
      `[IPFS] Published snapshot index at ${ipnsName} -> ${indexCid}`,
    );
  }

  async saveSnapshot(
    name: string,
    data: any,
    type: "memory" | "graph" | "full" = "full",
    description?: string,
    metadata?: Record<string, any>,
  ): Promise<{ id: string; cid: string; size: number }> {
    await this.ensureInitialized();

    const id = `snap-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    // Create snapshot object
    const snapshot: Snapshot = {
      id,
      name,
      description,
      timestamp,
      data,
      metadata,
    };

    // Store as DAG-CBOR
    const cid = await this.dag!.add(snapshot);

    // Get size info
    const size = JSON.stringify(snapshot).length;

    // Update index
    this.snapshotsIndex.set(id, {
      id,
      name,
      description,
      timestamp,
      cid: cid.toString(),
      size,
      type,
    });

    // Save updated index
    await this.saveIndex();

    // Also pin the CID if we have a pinning service configured
    const ipfsConfig = this.config.snapshotConfig || {};
    if (ipfsConfig.ipfsPinningService) {
      await this.pinCID(cid.toString()).catch((err) =>
        console.warn(`[IPFS] Failed to pin snapshot: ${err.message}`),
      );
    }

    console.log(`[IPFS] Saved snapshot "${name}" as ${cid}`);
    return { id, cid: cid.toString(), size };
  }

  async loadSnapshot(id: string): Promise<Snapshot | null> {
    await this.ensureInitialized();

    const metadata = this.snapshotsIndex.get(id);
    if (!metadata || !metadata.cid) {
      return null;
    }

    try {
      const cid = metadata.cid;
      // Need to parse string CID back to CID object
      const { CID } = await import("multiformats/cid");
      const cidObj = CID.parse(cid);
      const data = await this.dag!.get(cidObj);
      return data as Snapshot;
    } catch (error) {
      console.error(`[IPFS] Failed to load snapshot ${id}:`, error);
      return null;
    }
  }

  async listSnapshots(
    type?: "memory" | "graph" | "full",
  ): Promise<SnapshotMetadata[]> {
    await this.ensureInitialized();

    const snapshots = Array.from(this.snapshotsIndex.values());
    if (type) {
      return snapshots.filter((s) => s.type === type);
    }
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const existed = this.snapshotsIndex.delete(id);
    if (existed) {
      await this.saveIndex();
      console.log(`[IPFS] Deleted snapshot ${id} from index`);
    }
    return existed;
  }

  async resolveIPNS(name: string): Promise<string | null> {
    await this.ensureInitialized();

    try {
      const result = await this.ipnsClient!.resolve(name);
      return result.cid.toString();
    } catch {
      return null;
    }
  }

  async publishIPNS(name: string, cidStr: string): Promise<void> {
    await this.ensureInitialized();
    const { CID } = await import("multiformats/cid");
    const cid = CID.parse(cidStr);
    await this.ipnsClient!.publish(name, cid);
  }

  private async pinCID(cidStr: string): Promise<void> {
    const ipfsConfig = this.config.snapshotConfig || {};
    if (!ipfsConfig.ipfsPinningService) return;

    try {
      const response = await fetch(`${ipfsConfig.ipfsPinningService}/pins`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ipfsConfig.ipfsPinToken
            ? {
                Authorization: `Bearer ${ipfsConfig.ipfsPinToken}`,
              }
            : {}),
        },
        body: JSON.stringify({ cid: cidStr }),
      });

      if (!response.ok) {
        throw new Error(`Pinning failed: ${response.statusText}`);
      }
    } catch (error) {
      console.warn(`[IPFS] Pin service error:`, error);
    }
  }

  async getStats(): Promise<{
    peerId: string;
    snapshotCount: number;
    totalSize: number;
    ipnsRecords: number;
  }> {
    await this.ensureInitialized();

    const snapshotCount = this.snapshotsIndex.size;
    const totalSize = Array.from(this.snapshotsIndex.values()).reduce(
      (sum, s) => sum + s.size,
      0,
    );

    return {
      peerId: this.helia!.libp2p.peerId.toString(),
      snapshotCount,
      totalSize,
      ipnsRecords: snapshotCount,
    };
  }

  async close(): Promise<void> {
    if (this.helia) {
      await this.helia.stop();
      this.initialized = false;
    }
  }
}

export function createIPFSStore(config: Config): IPFSSnapshotStore {
  return new IPFSSnapshotStore(config);
}

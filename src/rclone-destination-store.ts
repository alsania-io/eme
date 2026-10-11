// EME Storage Router — Phase 2b: RcloneDestinationStore
// Implements ISnapshotStore over an rclone remote. Snapshots are written as
// JSON files via ADDITIVE `rclone copy` to a staging dir, then verified. The
// store keeps a local index (snapshots.json) and mirrors it to the remote so
// listSnapshots can work without a remote listing round-trip each call.
//
// See docs/EME_ROUTER_MODEL_2a.md §7 — new backends are new implementations,
// not new branches in core.

import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { Config, ISnapshotStore, SnapshotMetadata } from "./types.js";
import { RcloneBackend } from "./rclone-backend.js";

export interface RcloneStoreOptions {
  /** rclone remote:path prefix, e.g. "localtest:eme-snapshots" */
  remote: string;
  /** Local staging + index directory. */
  localPath: string;
  /** Optional EME-managed rclone.conf path. */
  rcloneConfigPath?: string;
}

export class RcloneDestinationStore implements ISnapshotStore {
  private remote: string;
  private basePath: string;
  private indexPath: string;
  private rclone: RcloneBackend;
  private rcloneConfigPath?: string;
  private initialized = false;
  private snapshots = new Map<string, SnapshotMetadata>();

  constructor(opts: RcloneStoreOptions, rclone?: RcloneBackend) {
    if (!opts.remote) throw new Error("RcloneDestinationStore requires a remote");
    this.remote = opts.remote.replace(/\/$/, "");
    this.basePath = opts.localPath;
    this.indexPath = path.join(this.basePath, "snapshots.json");
    this.rclone = rclone ?? new RcloneBackend();
    this.rcloneConfigPath = opts.rcloneConfigPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.basePath, { recursive: true });
    try {
      const raw = await fs.readFile(this.indexPath, "utf-8");
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([k, v]) =>
        this.snapshots.set(k, v as SnapshotMetadata),
      );
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.warn(`[RcloneStore] index load: ${err.message}`);
      }
    }
    this.initialized = true;
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private async saveIndex(): Promise<void> {
    const obj = Object.fromEntries(this.snapshots);
    await fs.writeFile(this.indexPath, JSON.stringify(obj, null, 2));
    // Best-effort mirror of the index to the remote (additive).
    await this.rclone.copy(
      this.indexPath,
      this.remote,
      { extraArgs: this.cfgArgs() },
    );
  }

  private cfgArgs(): string[] {
    return this.rcloneConfigPath ? ["--config", this.rcloneConfigPath] : [];
  }

  private checksum(data: any): string {
    return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }

  async saveSnapshot(
    name: string,
    data: any,
    type: "memory" | "graph" | "full" = "full",
    description?: string,
    metadata?: Record<string, any>,
  ): Promise<{ id: string; cid?: string; size: number }> {
    await this.ensureInit();
    const id = randomUUID();
    const timestamp = Date.now();
    const size = JSON.stringify(data).length;
    const checksum = this.checksum(data);

    const localFile = path.join(this.basePath, `${id}.json`);
    await fs.writeFile(
      localFile,
      JSON.stringify({ id, name, description, timestamp, data, metadata, checksum }, null, 2),
    );

    // ADDITIVE copy to the remote (never sync).
    const res = await this.rclone.copy(localFile, this.remote, {
      extraArgs: this.cfgArgs(),
    });
    if (!res.ok) {
      throw new Error(`rclone copy failed for snapshot ${id}: ${res.stderr.trim()}`);
    }

    this.snapshots.set(id, { id, name, description, timestamp, size, type });
    await this.saveIndex();
    return { id, size };
  }

  async loadSnapshot(id: string): Promise<any | null> {
    await this.ensureInit();
    const localFile = path.join(this.basePath, `${id}.json`);
    try {
      const raw = await fs.readFile(localFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.checksum && this.checksum(parsed.data) !== parsed.checksum) {
        console.warn(`[RcloneStore] checksum mismatch for ${id}`);
      }
      return parsed;
    } catch (err: any) {
      if (err.code === "ENOENT") {
        // Pull from remote on cache miss (additive copy down).
        const res = await this.rclone.copy(this.remote, this.basePath, {
          extraArgs: this.cfgArgs(),
        });
        if (!res.ok) return null;
        try {
          const raw = await fs.readFile(localFile, "utf-8");
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  async listSnapshots(type?: "memory" | "graph" | "full"): Promise<SnapshotMetadata[]> {
    await this.ensureInit();
    const all = Array.from(this.snapshots.values());
    const filtered = type ? all.filter((s) => s.type === type) : all;
    return filtered.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteSnapshot(id: string): Promise<boolean> {
    await this.ensureInit();
    const localFile = path.join(this.basePath, `${id}.json`);
    try {
      await fs.unlink(localFile);
    } catch {
      /* already gone locally */
    }
    const existed = this.snapshots.delete(id);
    if (existed) await this.saveIndex();
    // NOTE: remote copy is intentionally NOT deleted (additive-only contract).
    return existed;
  }

  async getStats(): Promise<{ snapshotCount: number; totalSize: number; [k: string]: any }> {
    await this.ensureInit();
    const snapshots = Array.from(this.snapshots.values());
    return {
      snapshotCount: snapshots.length,
      totalSize: snapshots.reduce((s, x) => s + x.size, 0),
      store: "rclone",
      remote: this.remote,
    };
  }

  async close(): Promise<void> {
    // No persistent handles to release.
  }
}

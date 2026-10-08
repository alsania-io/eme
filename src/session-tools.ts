/**
 * Session Tools for EME MCP Server
 */

import { z } from "zod";
import { sessionCache } from "./session-cache.js";
import type { MemoryManager } from "./memory-manager.js";

export const SessionPushSchema = z.object({
  session_id: z.string().min(1),
  instruction_text: z.string().min(1),
  source: z.enum(["user", "system", "agent"]).optional().default("user"),
  critical: z.boolean().optional().default(false),
  surface: z.boolean().optional().default(true),
  metadata: z.record(z.any()).optional(),
});

export const SessionGetSchema = z.object({
  session_id: z.string().min(1),
  user_message: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional().default(10),
  include_critical: z.boolean().optional().default(true),
  include_unacknowledged: z.boolean().optional().default(true),
  format: z.enum(["minified", "readable", "structured"]).optional().default("minified"),
});

export const SessionAckSchema = z.object({
  session_id: z.string().min(1),
  ids: z.array(z.string()).optional(),
  all_until_turn: z.number().int().optional(),
});

export const SessionClearSchema = z.object({
  session_id: z.string().min(1),
  preserve_critical: z.boolean().optional().default(true),
});

export const SessionCheckpointSchema = z.object({
  session_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const SessionRestoreSchema = z.object({
  session_id: z.string().min(1),
  checkpoint_id: z.string().min(1),
});

export const SessionListCheckpointsSchema = z.object({
  session_id: z.string().min(1),
});

export const SessionInfoSchema = z.object({
  session_id: z.string().min(1),
});

export const ContextPackSchema = z.object({
  session_id: z.string().min(1),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(20).optional().default(5),
  max_tokens: z.number().int().min(50).max(500).optional().default(200),
  format: z.enum(["minified", "readable", "structured"]).optional().default("minified"),
});

export class SessionToolHandlers {
  private memoryManager: MemoryManager | null = null;

  constructor(memoryManager?: MemoryManager) {
    if (memoryManager) this.memoryManager = memoryManager;
  }

  setMemoryManager(memoryManager: MemoryManager): void {
    this.memoryManager = memoryManager;
  }

  async handlePush(args: unknown): Promise<any> {
    const parsed = SessionPushSchema.parse(args);
    const instruction = sessionCache.push(parsed.session_id, parsed.instruction_text, parsed.source, parsed.critical, parsed.surface, parsed.metadata);
    return { id: instruction.id, turn: instruction.turn_number, success: true };
  }

  async handleGet(args: unknown): Promise<any> {
    const parsed = SessionGetSchema.parse(args);
    const result = sessionCache.get(parsed.session_id, parsed.user_message, parsed.limit, parsed.include_critical, parsed.include_unacknowledged);

    let longTermResults: any[] = [];
    if (this.memoryManager && parsed.user_message) {
      try {
        longTermResults = await this.memoryManager.searchMemories(parsed.user_message, 3);
      } catch (error) {
        console.error("[SessionTools] Long-term search failed:", error);
      }
    }

    let formattedContext = result.context;
    if (parsed.format === "readable") {
      formattedContext = result.entries.map(e => `[${e.type.toUpperCase()}] ${e.text}`).join("\n");
      if (longTermResults.length > 0) {
        formattedContext += "\n\n[LONG-TERM]\n" + longTermResults.map(r => `- ${r.memory.text.substring(0, 100)}...`).join("\n");
      }
    } else if (parsed.format === "structured") {
      formattedContext = JSON.stringify({ short_term: result.entries, long_term: longTermResults.map(r => ({ text: r.memory.text.substring(0, 200), score: r.score })), turn: result.turn, token_estimate: result.token_estimate }, null, 2);
    } else if (longTermResults.length > 0) {
      const longTermParts = longTermResults.map(r => `M:${r.memory.text.substring(0, 80)}${r.memory.text.length > 80 ? "..." : ""}`);
      formattedContext = result.context ? `${result.context}|${longTermParts.join("|")}` : longTermParts.join("|");
    }

    return { session_id: result.session_id, turn: result.turn, context: formattedContext, token_estimate: result.token_estimate + (longTermResults.length * 20), long_term_count: longTermResults.length };
  }

  async handleAck(args: unknown): Promise<any> {
    const parsed = SessionAckSchema.parse(args);
    let acknowledged = 0;
    if (parsed.ids && parsed.ids.length > 0) {
      acknowledged = sessionCache.acknowledge(parsed.session_id, parsed.ids);
    } else if (parsed.all_until_turn !== undefined) {
      acknowledged = sessionCache.acknowledgeUpToTurn(parsed.session_id, parsed.all_until_turn);
    } else {
      throw new Error("Either ids or all_until_turn must be provided");
    }
    return { acknowledged, success: true };
  }

  async handleClear(args: unknown): Promise<any> {
    const parsed = SessionClearSchema.parse(args);
    const result = sessionCache.clear(parsed.session_id, parsed.preserve_critical);
    return { cleared: result.cleared, preserved: result.preserved, success: true };
  }

  async handleCheckpoint(args: unknown): Promise<any> {
    const parsed = SessionCheckpointSchema.parse(args);
    const checkpoint = sessionCache.createCheckpoint(parsed.session_id, parsed.name, parsed.description);
    return { checkpoint_id: checkpoint.id, name: checkpoint.name, turn: checkpoint.turn_number, created_at: checkpoint.created_at, success: true };
  }

  async handleRestore(args: unknown): Promise<any> {
    const parsed = SessionRestoreSchema.parse(args);
    const success = sessionCache.restoreCheckpoint(parsed.session_id, parsed.checkpoint_id);
    if (!success) throw new Error(`Checkpoint not found: ${parsed.checkpoint_id}`);
    const info = sessionCache.getSessionInfo(parsed.session_id);
    return { success: true, restored_checkpoint: parsed.checkpoint_id, current_turn: info.currentTurn, instruction_count: info.instructionCount };
  }

  async handleListCheckpoints(args: unknown): Promise<any> {
    const parsed = SessionListCheckpointsSchema.parse(args);
    const checkpoints = sessionCache.listCheckpoints(parsed.session_id);
    return { session_id: parsed.session_id, checkpoints: checkpoints.map(c => ({ id: c.id, name: c.name, description: c.description, turn: c.turn_number, created_at: c.created_at })), count: checkpoints.length };
  }

  async handleInfo(args: unknown): Promise<any> {
    const parsed = SessionInfoSchema.parse(args);
    const info = sessionCache.getSessionInfo(parsed.session_id);
    return { session_id: parsed.session_id, exists: info.exists, instruction_count: info.instructionCount, current_turn: info.currentTurn, checkpoint_count: info.checkpointCount };
  }

  async handleContextPack(args: unknown): Promise<any> {
    const parsed = ContextPackSchema.parse(args);
    const { packMemories, packInstructions, packContext } = await import("./context-pack.js");
    
    let instructions: any[] = [];
    const session = sessionCache.getSession(parsed.session_id);
    if (session) {
      instructions = Array.from(session.values()).filter(i => !i.acknowledged);
    }
    
    let memories: any[] = [];
    if (parsed.query && this.memoryManager) {
      try {
        memories = await this.memoryManager.searchMemories(parsed.query, parsed.limit);
      } catch (error) {
        console.error("[SessionTools] Memory search failed:", error);
      }
    }
    
    let packed;
    if (instructions.length > 0 && memories.length > 0) {
      packed = packContext(memories, instructions, { maxTokens: parsed.max_tokens });
    } else if (instructions.length > 0) {
      packed = packInstructions(instructions, { maxTokens: parsed.max_tokens });
    } else {
      packed = packMemories(memories, { maxTokens: parsed.max_tokens });
    }
    
    let context = packed.context;
    if (parsed.format === "readable") {
      context = packed.entries.map(e => `[${e.type}] ${e.content.substring(0, 200)}`).join("\n");
    } else if (parsed.format === "structured") {
      context = JSON.stringify(packed, null, 2);
    }
    
    return { session_id: parsed.session_id, context, token_estimate: packed.tokenEstimate, instruction_count: instructions.length, memory_count: memories.length, format: parsed.format };
  }
}

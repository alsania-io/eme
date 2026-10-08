/**
 * Session Cache Module - Short-term memory for EME
 */

import { randomUUID } from "crypto";

export interface SessionInstruction {
  id: string;
  session_id: string;
  turn_number: number;
  instruction_text: string;
  source: "user" | "system" | "agent";
  critical: boolean;
  acknowledged: boolean;
  surface: boolean;
  metadata?: Record<string, any>;
  created_at: number;
  version: number;
}

export interface SessionCheckpoint {
  id: string;
  session_id: string;
  name: string;
  description?: string;
  turn_number: number;
  snapshot: {
    instructions: SessionInstruction[];
    turn: number;
  };
  created_at: number;
}

export interface ContextResult {
  session_id: string;
  turn: number;
  context: string;
  token_estimate: number;
  entries: Array<{
    type: "instruction" | "critical";
    text: string;
    source: string;
  }>;
}

export class SessionCache {
  private sessions: Map<string, Map<string, SessionInstruction>> = new Map();
  private turns: Map<string, number> = new Map();
  private checkpoints: Map<string, SessionCheckpoint[]> = new Map();

  push(sessionId: string, instructionText: string, source: "user" | "system" | "agent" = "user", critical: boolean = false, surface: boolean = true, metadata?: Record<string, any>): SessionInstruction {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Map());
      this.turns.set(sessionId, 0);
    }
    const currentTurn = this.turns.get(sessionId)! + 1;
    this.turns.set(sessionId, currentTurn);
    const instruction: SessionInstruction = {
      id: randomUUID(),
      session_id: sessionId,
      turn_number: currentTurn,
      instruction_text: instructionText,
      source,
      critical,
      acknowledged: false,
      surface,
      metadata,
      created_at: Date.now(),
      version: 1,
    };
    this.sessions.get(sessionId)!.set(instruction.id, instruction);
    return instruction;
  }

  get(sessionId: string, userMessage: string, limit: number = 10, includeCritical: boolean = true, includeUnacknowledged: boolean = true): ContextResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { session_id: sessionId, turn: 0, context: "", token_estimate: 0, entries: [] };
    }
    const currentTurn = this.turns.get(sessionId) || 0;
    let instructions = Array.from(session.values());
    if (includeCritical) instructions = instructions.filter(i => i.critical || !i.acknowledged);
    if (includeUnacknowledged) instructions = instructions.filter(i => !i.acknowledged);
    instructions.sort((a, b) => a.turn_number - b.turn_number);
    instructions = instructions.slice(-limit);
    const messageWords = userMessage.toLowerCase().split(/\s+/);
    const scored = instructions.map(inst => {
      let score = 0;
      if (inst.critical) score += 10;
      const instWords = inst.instruction_text.toLowerCase().split(/\s+/);
      for (const word of messageWords) {
        if (instWords.some(w => w.includes(word) || word.includes(w))) score++;
      }
      return { inst, score };
    });
    scored.sort((a, b) => b.score - a.score || b.inst.turn_number - a.inst.turn_number);
    const top = scored.slice(0, limit);
    const entries = top.map(({ inst }) => ({ type: inst.critical ? "critical" as const : "instruction" as const, text: inst.instruction_text, source: inst.source }));
    const contextParts: string[] = [];
    for (const { inst } of top) {
      const prefix = inst.critical ? "C:" : (inst.source === "user" ? "U:" : "S:");
      const truncated = inst.instruction_text.length > 100 ? inst.instruction_text.substring(0, 100) + "..." : inst.instruction_text;
      contextParts.push(`${prefix}${truncated}`);
    }
    return { session_id: sessionId, turn: currentTurn, context: contextParts.join("|"), token_estimate: Math.ceil(contextParts.join("|").length / 4), entries };
  }

  acknowledge(sessionId: string, ids: string[]): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    let acknowledged = 0;
    for (const id of ids) {
      const inst = session.get(id);
      if (inst && !inst.acknowledged) {
        inst.acknowledged = true;
        acknowledged++;
      }
    }
    return acknowledged;
  }

  acknowledgeUpToTurn(sessionId: string, turnNumber: number): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    let acknowledged = 0;
    for (const inst of session.values()) {
      if (inst.turn_number <= turnNumber && !inst.acknowledged) {
        inst.acknowledged = true;
        acknowledged++;
      }
    }
    return acknowledged;
  }

  clear(sessionId: string, preserveCritical: boolean = true): { cleared: number; preserved: number } {
    const session = this.sessions.get(sessionId);
    if (!session) return { cleared: 0, preserved: 0 };
    let cleared = 0, preserved = 0;
    if (preserveCritical) {
      for (const [id, inst] of session.entries()) {
        if (!inst.critical) {
          session.delete(id);
          cleared++;
        } else preserved++;
      }
    } else {
      cleared = session.size;
      this.sessions.delete(sessionId);
      this.turns.delete(sessionId);
      return { cleared, preserved: 0 };
    }
    this.turns.set(sessionId, 0);
    return { cleared, preserved };
  }

  createCheckpoint(sessionId: string, name: string, description?: string): SessionCheckpoint {
    const session = this.sessions.get(sessionId);
    const currentTurn = this.turns.get(sessionId) || 0;
    const checkpoint: SessionCheckpoint = {
      id: randomUUID(),
      session_id: sessionId,
      name,
      description,
      turn_number: currentTurn,
      snapshot: { instructions: session ? Array.from(session.values()) : [], turn: currentTurn },
      created_at: Date.now(),
    };
    if (!this.checkpoints.has(sessionId)) this.checkpoints.set(sessionId, []);
    this.checkpoints.get(sessionId)!.push(checkpoint);
    return checkpoint;
  }

  restoreCheckpoint(sessionId: string, checkpointId: string): boolean {
    const checkpoints = this.checkpoints.get(sessionId);
    if (!checkpoints) return false;
    const checkpoint = checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) return false;
    const newSession = new Map<string, SessionInstruction>();
    for (const inst of checkpoint.snapshot.instructions) newSession.set(inst.id, { ...inst });
    this.sessions.set(sessionId, newSession);
    this.turns.set(sessionId, checkpoint.turn_number);
    return true;
  }

  listCheckpoints(sessionId: string): SessionCheckpoint[] {
    return this.checkpoints.get(sessionId) || [];
  }

  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    const checkpoints = this.checkpoints.get(sessionId);
    if (!checkpoints) return false;
    const index = checkpoints.findIndex(c => c.id === checkpointId);
    if (index === -1) return false;
    checkpoints.splice(index, 1);
    return true;
  }

  getSessionInfo(sessionId: string): { exists: boolean; instructionCount: number; currentTurn: number; checkpointCount: number } {
    const session = this.sessions.get(sessionId);
    const checkpoints = this.checkpoints.get(sessionId);
    return {
      exists: !!session,
      instructionCount: session ? session.size : 0,
      currentTurn: this.turns.get(sessionId) || 0,
      checkpointCount: checkpoints ? checkpoints.length : 0,
    };
  }

  getSession(sessionId: string): Map<string, SessionInstruction> | undefined {
    return this.sessions.get(sessionId);
  }
}

export const sessionCache = new SessionCache();

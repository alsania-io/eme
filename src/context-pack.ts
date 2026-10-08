/**
 * Context Pack - Token-efficient context distillation
 * 
 * Replaces ContextStream's pack mode with EME-native implementation.
 * Converts search results and session context into minified format:
 * 
 * Format codes:
 *   W: Workspace context
 *   P: Project context
 *   D: Decision
 *   M: Memory (from vector search)
 *   T: Task
 *   L: Lesson
 *   I: Instruction
 *   C: Critical instruction
 */

import type { SearchResult } from "./types.js";
import type { SessionInstruction } from "./session-cache.js";

export interface ContextPackOptions {
  maxTokens?: number;      // Target token limit (default: 200)
  format?: "minified" | "readable" | "structured";
  includeScores?: boolean;
}

export interface PackedContext {
  context: string;         // Minified string
  tokenEstimate: number;
  entries: Array<{
    type: string;
    content: string;
    score?: number;
  }>;
}

/**
 * Rough token estimator (4 chars ~ 1 token for English text)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token budget
 */
function truncateToBudget(text: string, remainingBudget: number, typePrefix: string = ""): string {
  const prefixCost = estimateTokens(typePrefix);
  const availableForText = Math.max(10, remainingBudget - prefixCost);
  const maxChars = availableForText * 4;
  
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + "...";
}

/**
 * Pack memories into minified context format
 */
export function packMemories(
  memories: SearchResult[],
  options: ContextPackOptions = {}
): PackedContext {
  const maxTokens = options.maxTokens || 200;
  const entries: PackedContext["entries"] = [];
  let currentTokens = 0;

  for (const result of memories) {
    const memory = result.memory;
    const score = result.score;
    
    // Determine type based on metadata
    let type = "M";  // Default: Memory
    if (memory.metadata?.tags?.includes("decision")) type = "D";
    if (memory.metadata?.tags?.includes("lesson")) type = "L";
    if (memory.metadata?.tags?.includes("task")) type = "T";
    if (memory.metadata?.namespace === "project") type = "P";
    if (memory.metadata?.namespace === "workspace") type = "W";
    
    // Truncate text to fit budget
    const entryText = truncateToBudget(memory.text, maxTokens - currentTokens, `${type}:`);
    const entryString = `${type}:${entryText}`;
    const entryTokens = estimateTokens(entryString);
    
    if (currentTokens + entryTokens > maxTokens) break;
    
    entries.push({
      type,
      content: memory.text,
      score: options.includeScores ? score : undefined,
    });
    
    currentTokens += entryTokens;
  }

  // Build context string
  let context = entries.map(e => {
    const truncated = e.content.length > 80 ? e.content.substring(0, 80) + "..." : e.content;
    return `${e.type}:${truncated}`;
  }).join("|");

  return {
    context,
    tokenEstimate: currentTokens,
    entries,
  };
}

/**
 * Pack session instructions into minified context format
 */
export function packInstructions(
  instructions: SessionInstruction[],
  options: ContextPackOptions = {}
): PackedContext {
  const maxTokens = options.maxTokens || 200;
  const entries: PackedContext["entries"] = [];
  let currentTokens = 0;

  for (const inst of instructions) {
    const type = inst.critical ? "C" : (inst.source === "user" ? "I" : "S");
    const entryText = truncateToBudget(inst.instruction_text, maxTokens - currentTokens, `${type}:`);
    const entryString = `${type}:${entryText}`;
    const entryTokens = estimateTokens(entryString);
    
    if (currentTokens + entryTokens > maxTokens) break;
    
    entries.push({
      type,
      content: inst.instruction_text,
    });
    
    currentTokens += entryTokens;
  }

  const context = entries.map(e => {
    const truncated = e.content.length > 80 ? e.content.substring(0, 80) + "..." : e.content;
    return `${e.type}:${truncated}`;
  }).join("|");

  return {
    context,
    tokenEstimate: currentTokens,
    entries,
  };
}

/**
 * Combined pack - memories + instructions
 */
export function packContext(
  memories: SearchResult[],
  instructions: SessionInstruction[],
  options: ContextPackOptions = {}
): PackedContext {
  const memPack = packMemories(memories, { ...options, maxTokens: options.maxTokens ? options.maxTokens / 2 : 100 });
  const instPack = packInstructions(instructions, { ...options, maxTokens: options.maxTokens ? options.maxTokens / 2 : 100 });
  
  const combinedEntries = [...memPack.entries, ...instPack.entries];
  const combinedContext = [memPack.context, instPack.context].filter(c => c).join("|");
  
  return {
    context: combinedContext,
    tokenEstimate: memPack.tokenEstimate + instPack.tokenEstimate,
    entries: combinedEntries,
  };
}

# EME Enhanced Memory Protocol v2.0
# Inspired by Supermemory auto-capture patterns
# Applied to EME's Qdrant am2 vector backend

## Auto-Capture Rules

### Store on Every Interaction
After EVERY user message, evaluate if it contains:
- Technical preferences (languages, tools, frameworks)
- Project requirements or constraints
- Opinions or feedback on approaches
- Problem-solving patterns
- Personal context (mood, availability, resources)
- Decisions made (even small ones)
- Errors encountered and their fixes
- Wallet addresses, contract addresses, IPFS CIDs

### Capture Threshold
If ANY of the above is detected, store immediately. Do not wait for explicit "remember this" commands.

### Storage Format
```json
{
  "type": "memory",
  "content": "What was learned",
  "context": "Why it matters",
  "timestamp": "ISO 8601",
  "tags": ["relevant", "tags"],
  "priority": "high|medium|low",
  "source": "conversation|tool_output|decision"
}
```

## Memory Cap & Pruning

### Limits
- Hot memory: 100 items (always loaded)
- Warm memory: 500 items (loaded on context match)
- Cold memory: Qdrant only (searched on demand)

### Auto-Pruning
When hot memory exceeds 100:
1. Demote lowest-priority items to warm
2. When warm exceeds 500:
   - Demote oldest low-priority items to cold
   - Flag duplicates and merge
3. Cold memory in Qdrant: keep indefinitely but de-prioritize in search

## Search-First Behavior

### Before Every Response
1. Search EME for relevant context using user's current query
2. Check hot memory for recent related items
3. If none found, search warm memory
4. Integrate findings into response

### Search Query Construction
- Extract key terms from user's message
- Add project context tags
- Include recent session identifier
- Search against vector name v2048 in collection am2

## Session Continuity

### Session Start
1. Load hot memory from local snapshot
2. Query Qdrant for recent memories (last 24 hours)
3. Restore active project context
4. Report: "Memory restored. X hot items, Y warm items loaded."

### Session End
1. Save hot memory snapshot to disk
2. Sync new memories to Qdrant
3. Update project context file
4. Clean up old snapshots (keep last 5)

## Integration with Alsania Memory Files

### Local Filesystem Backup
- Hot snapshot: /home/sigma/Desktop/echo-lab/mcp-memory/aegis-memory/aegis-state-snapshot-YYYY-MM-DD.md
- Project context: /home/sigma/Desktop/echo-lab/mcp-memory/aegis-memory/aegis-project-context.md
- Working protocol: /home/sigma/Desktop/echo-lab/mcp-memory/aegis-memory/aegis-working-protocol.md

### Qdrant Collection
- Collection: am2
- Vector name: v2048
- Host: localhost:6333
- Multi-vector setup: v384 + v2048

## Memory Tool Commands

### Store Memory
```
eme:store_memory(content, context, tags, priority)
→ Stores to Qdrant am2 with auto-vectorization
→ Also updates local snapshot
```

### Search Memory  
```
eme:search_memories(query, limit=5)
→ Semantic search against v2048
→ Returns ranked results with scores
```

### Get Recent
```
eme:get_recent_memories(hours=24, limit=20)
→ Time-based retrieval
→ Useful for session continuity
```

### Prune Memory
```
eme:prune_memories()
→ Auto-demotes based on priority/age
→ Reports what was moved where
```

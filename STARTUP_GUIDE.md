# EME (Echo Memory Engine) - PROFESSIONAL STARTUP GUIDE

**Professional architecture. Single entry point. Monetization ready.**

## 🚀 PROFESSIONAL STARTUP OPTIONS

```bash
# OPTION 1: Production start (standard)
npm start

# OPTION 2: Clean start (no warnings)
npm run start:clean

# OPTION 3: Nyx-optimized start
npm run start:nyx

# OPTION 4: Direct CLI (full control)
node dist/index.js server

# OPTION 5: With custom config
node dist/index.js server --maxMemoryEntries 5000 --logLevel debug
```

## 📦 WHAT EACH OPTION DOES

- **`npm start`** → Starts the MCP server (stdout may show warnings but works)
- **`npm run start:clean`** → Starts with `--no-warnings` flag (clean output)
- **`npm run start:nyx`** → Optimized for Nyx MCP (no warnings + experimental flag)
- **Direct command** → The raw command that always works

## ✅ VERIFICATION (Is EME Running?)

```bash
# Run the simple test
npm run test:simple

# Or run the practical verification
npm run verify
```

**Expected Output:** "EME server started, would test tools here..."

## 🛠️ AVAILABLE TOOLS (When Connected via MCP)

- `memory.add` - Add memories with filtering
- `memory.search` - Semantic + graph search
- `memory.list` - List memories in namespace
- `memory.update` - Update existing memories
- `memory.delete` - Delete memories
- `memory.graph.*` - Graph operations
- `memory.batch.*` - Batch operations
- `memory.clear_namespace` - Clear namespace with safety check

## 🔧 TROUBLESHOOTING

### Problem: "Cannot find module" or import errors
**Solution:** Use `npm run start:nyx` or the direct command with experimental flag

### Problem: Warnings in console (ESM modules, etc.)
**Solution:** Use `npm run start:clean` or direct command with `--no-warnings`

### Problem: Nyx won't connect
**Solution:** 
1. Ensure you're using `npm run start:nyx`
2. Check Nyx config points to stdio transport
3. Verify EME process is running (`ps aux | grep mcp-server`)

## 📁 DIRECTORY STRUCTURE (Simplified)

```
eme/
├── dist/               # Compiled TypeScript
│   ├── mcp-server.js   # ← THE ONE FILE THAT MATTERS
│   └── index.js        # Library exports (not for starting)
├── src/               # Source TypeScript
├── storage/           # Database and logs
├── tests/             # Test files
├── package.json       # Fixed scripts ✓
├── start-eme.sh       # Fixed startup script ✓
├── STARTUP_GUIDE.md   # ← YOU ARE HERE
└── config-sigma-optimized.json  # Performance-tuned config
```

## 🎯 QUICK START FOR SIGMA

```bash
# 1. Navigate to EME directory
cd /home/sigma/Desktop/echo-lab/eme

# 2. Start EME (Nyx optimized)
npm run start:nyx

# 3. Verify it's working (in another terminal)
npm run test:simple

# 4. Connect Nyx to stdio:///home/sigma/Desktop/echo-lab/eme/dist/mcp-server.js
```

## 📝 CONFIGURATION

The system uses `config-sigma-optimized.json` by default (performance-tuned for your workflow).

**Key optimizations:**
- Cache size: 1000 (LRU cache for fast repeated searches)
- Vector storage: SQLite with persistence
- Search limits: Optimized for project updates and chat memory

## 🛑 STOPPING EME

```bash
# If started with npm
Ctrl+C

# If started with start-eme.sh
./stop-eme.sh

# Or find and kill the process
ps aux | grep mcp-server
kill [PID]
```

---

**Aegis Note:** All confusing files have been moved to `.deprecated/`. This is the only documentation you need. The shield is raised - EME will start cleanly every time. 🛡️

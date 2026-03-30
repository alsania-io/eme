#!/bin/bash

# EME (Echo Memory Engine) Quick Start Script
# Aegis Deployment Script - December 24, 2025

echo "========================================"
echo "    ECHO MEMORY ENGINE (EME) v1.0.0"
echo "    Deployment Script by Aegis"
echo "========================================"
echo ""

# Configuration
EME_DIR="/home/sigma/Desktop/echo-lab/eme"
CONFIG_FILE="$EME_DIR/storage/config-production-working.json"
LOG_FILE="$EME_DIR/storage/logs/eme.log"
PID_FILE="$EME_DIR/storage/eme.pid"
STORAGE_DIR="$EME_DIR/storage"

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p "$STORAGE_DIR"
mkdir -p "$EME_DIR/logs"
mkdir -p "$STORAGE_DIR/snapshots"

# Check if EME is already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "⚠️  EME is already running (PID: $OLD_PID)"
        echo "   To restart, run: stop-eme.sh first"
        exit 1
    else
        echo "🧹 Cleaning up stale PID file..."
        rm -f "$PID_FILE"
    fi
fi

# Check if TypeScript is compiled
echo "🔧 Checking build status..."
if [ ! -f "$EME_DIR/dist/index.js" ]; then
    echo "   ❌ TypeScript not compiled. Building..."
    cd "$EME_DIR"
    npm run build
    if [ $? -ne 0 ]; then
        echo "   ❌ Build failed. Please check TypeScript errors."
        exit 1
    fi
    echo "   ✅ Build successful"
fi

# Load configuration
echo "⚙️  Loading configuration..."
export NODE_ENV=production
if [ -f "$CONFIG_FILE" ]; then
    export EME_CONFIG="$CONFIG_FILE"
    echo "   ✅ Using config: $(basename "$CONFIG_FILE") (Sigma-optimized)"
    echo "   📊 Performance-tuned for: Project updates, chat memory, decisions"
else
    echo "   ⚠️  Sigma-optimized config not found: $(basename "$CONFIG_FILE")"
    echo "   🔄 Falling back to config-example.json"
    FALLBACK_CONFIG="$EME_DIR/storage/config-example.json"
    if [ -f "$FALLBACK_CONFIG" ]; then
        export EME_CONFIG="$FALLBACK_CONFIG"
        CONFIG_FILE="$FALLBACK_CONFIG"
        echo "   ✅ Using fallback config: config-example.json"
    else
        echo "   ⚠️  No config file found, using defaults"
        echo "   ℹ️  Create $CONFIG_FILE for Sigma-optimized performance"
    fi
fi

# Start EME MCP server
echo "🚀 Starting EME MCP Server (Professional CLI)..."
cd "$EME_DIR"

# Start in background with professional CLI (no warnings, Nyx compatible)
node --no-warnings --experimental-specifier-resolution=node dist/index.js server >> "$LOG_FILE" 2>&1 &
EME_PID=$!

# Save PID
echo $EME_PID > "$PID_FILE"

# Wait a moment for server to initialize
sleep 2

# Verify server is running
if kill -0 "$EME_PID" 2>/dev/null; then
    echo "✅ EME MCP Server started successfully!"
    echo ""
    echo "📊 DEPLOYMENT INFORMATION:"
    echo "   PID: $EME_PID (saved to eme.pid)"
    echo "   Logs: $LOG_FILE"
    echo "   Storage: $STORAGE_DIR/"
    echo "   Config: $CONFIG_FILE"
    echo ""
    echo "🔌 MCP CONNECTION:"
    echo "   Transport: stdio (standard MCP protocol)"
    echo "   Tools: 10+ memory operations available"
    echo "   Namespace: Default (configurable per agent)"
    echo ""
    echo "🛠️  AVAILABLE TOOLS:"
    echo "   1. memory.add - Add memory with filtering"
    echo "   2. memory.search - Semantic + graph search"
    echo "   3. memory.graph.* - Graph operations"
    echo "   4. memory.snapshot.* - Backup/restore"
    echo "   5. memory.moderation.* - Shared memory review"
    echo ""
    echo "🎯 QUICK TEST:"
    echo "   Run: node test-proper.js"
    echo "   This verifies all 3 memory components"
    echo ""
    echo "🛑 STOPPING:"
    echo "   Run: ./stop-eme.sh"
    echo "   Or: kill $(cat eme.pid)"
    echo ""
    echo "========================================"
    echo "EME deployed and ready for persistent memory!"
    echo "Aegis operational phrase: Memory shield active."
    echo "========================================"
else
    echo "❌ Failed to start EME server"
    echo "   Check logs: tail -f $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi

#!/bin/bash

# EME Stop Script
# Gracefully stops the Echo Memory Engine

echo "========================================"
echo "    Stopping Echo Memory Engine"
echo "========================================"
echo ""

EME_DIR="/home/sigma/Desktop/echo-lab/memory-engine"
PID_FILE="$EME_DIR/eme.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "ℹ️  EME is not running (no PID file found)"
    echo "   PID file: $PID_FILE"
    exit 0
fi

PID=$(cat "$PID_FILE")

if [ -z "$PID" ]; then
    echo "⚠️  PID file exists but is empty"
    rm -f "$PID_FILE"
    exit 1
fi

if ! kill -0 "$PID" 2>/dev/null; then
    echo "⚠️  Process $PID not found (already stopped?)"
    rm -f "$PID_FILE"
    exit 0
fi

echo "🛑 Stopping EME process (PID: $PID)..."

# Send SIGTERM for graceful shutdown
kill -TERM "$PID"

# Wait for process to exit
timeout=10
for i in $(seq 1 $timeout); do
    if ! kill -0 "$PID" 2>/dev/null; then
        echo "✅ EME stopped gracefully"
        rm -f "$PID_FILE"
        exit 0
    fi
    sleep 1
    echo -n "."
done

echo ""

echo "⚠️  Process did not stop gracefully, forcing..."
kill -9 "$PID" 2>/dev/null

if ! kill -0 "$PID" 2>/dev/null; then
    echo "✅ EME stopped (forced)"
    rm -f "$PID_FILE"
else
    echo "❌ Failed to stop process $PID"
    echo "   You may need to manually kill the process"
    exit 1
fi

echo ""
echo "========================================"
echo "    EME stopped successfully"
echo "========================================"
#!/bin/bash

# EME Podman Deployment Script
# Rootless container deployment for Echo Memory Engine

echo "========================================"
echo "    EME Podman Deployment"
echo "    Rootless Container Runtime"
echo "========================================"
echo ""

# Configuration
CONTAINER_NAME="eme"
IMAGE_NAME="localhost/eme:latest"
VOLUME_NAME="eme-storage"
PORT="8048"  # Standard MCP port

# Check if Podman is available
if ! command -v podman &> /dev/null; then
    echo "❌ Podman not found. Please install Podman first:"
    echo "   Ubuntu/Debian: sudo apt install podman"
    echo "   Fedora/RHEL: sudo dnf install podman"
    echo "   Arch: sudo pacman -S podman"
    exit 1
fi

echo "✅ Podman detected: $(podman --version)"

echo ""
echo "🔧 Building EME container image..."

# Build container image
podman build -t "$IMAGE_NAME" -f Containerfile .

if [ $? -ne 0 ]; then
    echo "❌ Failed to build container image"
    exit 1
fi

echo "✅ Container image built: $IMAGE_NAME"

echo ""
echo "📦 Creating persistent storage volume..."

# Create persistent volume for storage
if ! podman volume exists "$VOLUME_NAME" 2>/dev/null; then
    podman volume create "$VOLUME_NAME"
    echo "✅ Volume created: $VOLUME_NAME"
else
    echo "✅ Volume already exists: $VOLUME_NAME"
fi

echo ""
echo "🚀 Deploying EME container..."

# Stop existing container if running
if podman container exists "$CONTAINER_NAME" 2>/dev/null; then
    echo "🔄 Stopping existing container..."
    podman stop "$CONTAINER_NAME"
    podman rm "$CONTAINER_NAME"
fi

# Run container with rootless configuration
podman run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "$PORT:8048" \
  -v "$VOLUME_NAME:/app/storage:Z" \
  -v "./logs:/app/logs:Z" \
  -e "NODE_ENV=production" \
  -e "LOG_LEVEL=info" \
  --security-opt label=disable \
  --userns=keep-id \
  "$IMAGE_NAME"

if [ $? -ne 0 ]; then
    echo "❌ Failed to start container"
    exit 1
fi

echo "✅ Container deployed: $CONTAINER_NAME"

# Wait for container to start
sleep 3

echo ""
echo "📊 Deployment Status:"

echo "1. Container status:"
podman ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "2. Storage volume:"
podman volume inspect "$VOLUME_NAME" --format "{{.Mountpoint}}" | xargs ls -la

echo ""
echo "3. Container logs (last 10 lines):"
podman logs --tail 10 "$CONTAINER_NAME"

echo ""
echo "🔌 Connection Information:"
echo "   MCP Server: Running in container $CONTAINER_NAME"
echo "   Host Port: $PORT (maps to container 8048)"
echo "   Transport: HTTP/SSE available at http://localhost:$PORT"
echo "   Stdio: Use podman exec for stdio transport"

echo ""
echo "🛠️ Management Commands:"
echo "   View logs: podman logs -f $CONTAINER_NAME"
echo "   Stop: podman stop $CONTAINER_NAME"
echo "   Start: podman start $CONTAINER_NAME"
echo "   Restart: podman restart $CONTAINER_NAME"
echo "   Shell access: podman exec -it $CONTAINER_NAME sh"
echo "   Remove: podman rm -f $CONTAINER_NAME"

echo ""
echo "📁 Persistent Storage:"
echo "   Volume: $VOLUME_NAME"
echo "   Data preserved across container updates"
echo "   Backup: podman volume export $VOLUME_NAME > eme-backup.tar"

echo ""
echo "========================================"
echo "    EME deployed with Podman!"
echo "    Rootless, secure, persistent"
echo "========================================"

echo ""
echo "🎯 Quick Test:"
echo "   curl http://localhost:$PORT/health"
echo "   Should return: {"status":"healthy"}"

echo ""
echo "🐧 Podman deployment complete. Memory shield containerized."

#!/bin/bash

# EME Podman Management Script
# Complete lifecycle management for EME containers

echo "========================================"
echo "    EME Podman Management Console"
echo "========================================"
echo ""

CONTAINER_NAME="eme"
IMAGE_NAME="localhost/eme:latest"
VOLUME_NAME="eme-storage"
PORT="8048"

# Check Podman
if ! command -v podman &> /dev/null; then
    echo "❌ Podman not installed"
    exit 1
fi

case "${1}" in
    "start"|"up")
        echo "🚀 Starting EME with Podman..."
        if [ -f "podman-compose.yaml" ]; then
            podman-compose up -d
        else
            podman run -d \
              --name "$CONTAINER_NAME" \
              --restart unless-stopped \
              -p "$PORT:8048" \
              -v "$VOLUME_NAME:/app/storage:Z" \
              -e "NODE_ENV=production" \
              "$IMAGE_NAME"
        fi
        echo "✅ EME started on port $PORT"
        ;;

    "stop"|"down")
        echo "🛑 Stopping EME..."
        if [ -f "podman-compose.yaml" ]; then
            podman-compose down
        else
            podman stop "$CONTAINER_NAME" 2>/dev/null
            podman rm "$CONTAINER_NAME" 2>/dev/null
        fi
        echo "✅ EME stopped"
        ;;

    "restart")
        echo "🔄 Restarting EME..."
        $0 stop
        sleep 2
        $0 start
        ;;

    "status")
        echo "📊 EME Container Status:"
        echo ""
        podman ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"
        echo ""
        echo "📈 Resource Usage:"
        podman stats "$CONTAINER_NAME" --no-stream --format "table {{.Name}}\t{{.CPU}}%\t{{.MemUsage}}\t{{.Mem}}%\t{{.NetIO}}\t{{.BlockIO}}"
        ;;

    "logs")
        echo "📋 EME Container Logs:"
        echo ""
        if [ -n "${2}" ]; then
            podman logs --tail "${2}" "$CONTAINER_NAME"
        else
            podman logs --tail 50 "$CONTAINER_NAME"
        fi
        ;;

    "follow"|"tail")
        echo "👀 Following EME logs (Ctrl+C to stop)..."
        podman logs -f "$CONTAINER_NAME"
        ;;

    "shell"|"exec")
        echo "🐚 Entering EME container shell..."
        podman exec -it "$CONTAINER_NAME" sh
        ;;

    "build")
        echo "🔨 Building EME container image..."
        podman build -t "$IMAGE_NAME" -f Containerfile .
        echo "✅ Image built: $IMAGE_NAME"
        ;;

    "update")
        echo "🔄 Updating EME container..."
        $0 stop
        $0 build
        $0 start
        ;;

    "backup")
        echo "💾 Backing up EME storage volume..."
        BACKUP_FILE="eme-backup-$(date +%Y%m%d_%H%M%S).tar"
        podman volume export "$VOLUME_NAME" > "$BACKUP_FILE"
        echo "✅ Backup created: $BACKUP_FILE"
        ls -lh "$BACKUP_FILE"
        ;;

    "restore")
        if [ -z "${2}" ]; then
            echo "❌ Please specify backup file: $0 restore backup.tar"
            exit 1
        fi
        echo "🔄 Restoring EME from backup..."
        $0 stop
        podman volume rm "$VOLUME_NAME" 2>/dev/null
        podman volume create "$VOLUME_NAME"
        podman volume import "$VOLUME_NAME" "${2}"
        $0 start
        echo "✅ Restored from: ${2}"
        ;;

    "clean")
        echo "🧹 Cleaning unused Podman resources..."
        podman system prune -f
        echo "✅ Cleanup complete"
        ;;

    "test")
        echo "🧪 Testing EME connection..."
        if curl -s "http://localhost:$PORT/health" > /dev/null; then
            echo "✅ EME is responding"
            curl -s "http://localhost:$PORT/health" | jq . 2>/dev/null || \
            curl -s "http://localhost:$PORT/health"
        else
            echo "❌ EME is not responding on port $PORT"
        fi
        ;;

    "help"|""|"*")
        echo "📖 EME Podman Management Commands:"
        echo ""
        echo "  $0 start       - Start EME container"
        echo "  $0 stop        - Stop EME container"
        echo "  $0 restart     - Restart EME container"
        echo "  $0 status      - Show container status and resources"
        echo "  $0 logs [N]    - Show last N lines of logs (default: 50)"
        echo "  $0 follow      - Follow logs in real-time"
        echo "  $0 shell       - Open shell in container"
        echo "  $0 build       - Build container image"
        echo "  $0 update      - Stop, rebuild, and restart"
        echo "  $0 backup      - Backup storage volume"
        echo "  $0 restore FILE - Restore from backup file"
        echo "  $0 clean       - Clean unused Podman resources"
        echo "  $0 test        - Test EME connection"
        echo "  $0 help        - Show this help"
        echo ""
        echo "Examples:"
        echo "  $0 start       # Start EME"
        echo "  $0 logs 100    # Show last 100 log lines"
        echo "  $0 backup      # Create backup"
        echo ""
        echo "🐧 Podman: Rootless, Secure, Production-Ready"
        ;;
esac

echo ""
echo "========================================"
echo "    Aegis Podman Management Complete"
echo "========================================"

#!/bin/bash

# Simple start script for EME stack with --replace flag

set -e

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
MEMORY_PATH="/home/sigma/Desktop/echo-lab/mcp-memory"
POSTGRES_PATH="$MEMORY_PATH/postgres"
REDIS_PATH="$MEMORY_PATH/redis-data"

# Container names
POSTGRES_CONTAINER="postgres-eme"
REDIS_CONTAINER="redis-eme"
QDRANT_CONTAINER="qdrant-alsania"

# PostgreSQL configuration
POSTGRES_USER="eme"
POSTGRES_PASSWORD="eme_password"
POSTGRES_DB="eme_graph"

echo -e "${YELLOW}Starting EME Stack...${NC}\n"

# Check Qdrant
if ! podman ps | grep -q $QDRANT_CONTAINER; then
    echo -e "${YELLOW}Starting Qdrant...${NC}"
    podman run -d --replace \
        --name $QDRANT_CONTAINER \
        -p 6333:6333 \
        -v "$MEMORY_PATH/qdrant/storage":/qdrant/storage:Z \
        -v "$MEMORY_PATH/qdrant/config":/qdrant/config:Z \
        docker.io/qdrant/qdrant:latest \
        ./qdrant --uri http://localhost:6333
    sleep 5
else
    echo -e "${GREEN}✓ Qdrant already running${NC}"
fi

# Create directories if they don't exist
mkdir -p "$POSTGRES_PATH" "$REDIS_PATH" 2>/dev/null || true

# Start PostgreSQL with --replace
if ! podman ps | grep -q $POSTGRES_CONTAINER; then
    echo -e "${YELLOW}Starting PostgreSQL...${NC}"
    podman run -d --replace \
        --name $POSTGRES_CONTAINER \
        -e POSTGRES_USER=$POSTGRES_USER \
        -e POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
        -e POSTGRES_DB=$POSTGRES_DB \
        -p 5432:5432 \
        -v $POSTGRES_PATH:/var/lib/postgresql/data:Z \
        docker.io/pgvector/pgvector:pg16
    sleep 10
else
    echo -e "${GREEN}✓ PostgreSQL already running${NC}"
fi

# Start Redis with --replace
if ! podman ps | grep -q $REDIS_CONTAINER; then
    echo -e "${YELLOW}Starting Redis...${NC}"
    podman run -d --replace \
        --name $REDIS_CONTAINER \
        -p 6379:6379 \
        -v $REDIS_PATH:/data:Z \
        docker.io/redis:alpine \
        redis-server --appendonly yes
    sleep 5
else
    echo -e "${GREEN}✓ Redis already running${NC}"
fi

# Show status
echo -e "\n${YELLOW}Container Status:${NC}"
podman ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E 'postgres-eme|redis-eme|qdrant-alsania'

# Create working config
echo -e "\n${YELLOW}Creating EME configuration...${NC}"
cat > /home/sigma/Desktop/echo-lab/eme/storage/config-production-working.json << 'EOF'
{
  "embeddingModel": "local",
  "embeddingDimension": 384,
  "vectorStore": "qdrant",
  "qdrantUrl": "http://localhost:6333",
  "qdrantCollection": "eme_vectors",
  "graphStore": "jsonl",
  "graphStorePath": "/home/sigma/Desktop/echo-lab/eme/storage/graph.jsonl",
  "snapshotStore": "filesystem",
  "snapshotPath": "/home/sigma/Desktop/echo-lab/eme/storage/snapshots",
  "memoryGateEnabled": true,
  "memoryGateThreshold": 0.3,
  "maxMemoryEntries": 10000,
  "similarityThreshold": 0.3,
  "logLevel": "info"
}
EOF

echo -e "${GREEN}✓ Configuration created${NC}"

echo -e "\n${GREEN}✅ EME Stack is ready!${NC}"
echo -e "\nTo start EME:"
echo "  cd /home/sigma/Desktop/echo-lab/eme"
echo "  node dist/index.js --config ./storage/config-production-working.json"

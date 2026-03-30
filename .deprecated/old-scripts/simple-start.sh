#!/bin/bash

# Simple start script for EME stack
# This script starts containers without trying to change permissions

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

echo -e "${YELLOW}Starting EME Stack...${NC}\
"

# Check Qdrant
if ! podman ps | grep -q $QDRANT_CONTAINER; then
    echo -e "${YELLOW}Starting Qdrant...${NC}"
    podman run -d \
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

# Remove PostgreSQL and Redis if they exist (let podman recreate with fresh volumes)
podman rm -f $POSTGRES_CONTAINER 2>/dev/null || true
podman rm -f $REDIS_CONTAINER 2>/dev/null || true

# Let podman create the directories with correct permissions
mkdir -p "$POSTGRES_PATH" "$REDIS_PATH" 2>/dev/null || true

# Start PostgreSQL
if ! podman ps | grep -q $POSTGRES_CONTAINER; then
    echo -e "${YELLOW}Starting PostgreSQL...${NC}"
    podman run -d \
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

# Start Redis
if ! podman ps | grep -q $REDIS_CONTAINER; then
    echo -e "${YELLOW}Starting Redis...${NC}"
    podman run -d \
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
echo -e "\
${YELLOW}Container Status:${NC}"
podman ps --format 'table {{.Names}}\	{{.Status}}\	{{.Ports}}' | grep -E 'postgres-eme|redis-eme|qdrant-alsania'

# Create working config
echo -e "\
${YELLOW}Creating EME configuration...${NC}"
cat > /home/sigma/Desktop/echo-lab/eme/storage/config-production-working.json << 'EOF'
{
  
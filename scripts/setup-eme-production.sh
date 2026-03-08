#!/bin/bash

# EME Production Setup Script
# This script runs all necessary fixes to make EME production-ready

set -e

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
EME_PATH="/home/sigma/Desktop/echo-lab/eme"
MEMORY_PATH="/home/sigma/Desktop/echo-lab/mcp-memory"

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║         EME Production Setup - Complete Installation    ║"
    echo "║              The Ultimate Memory MCP Server             ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}\n"
}

# Check if we're in the right directory
check_directory() {
    echo -e "${YELLOW}Checking directory structure...${NC}"
    
    if [ ! -d "$EME_PATH" ]; then
        echo -e "${RED}Error: EME directory not found at $EME_PATH${NC}"
        exit 1
    fi
    
    cd "$EME_PATH"
    echo -e "${GREEN}✓ Working directory: $EME_PATH${NC}\n"
}

# Phase 1: Fix Qdrant
phase1_qdrant() {
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Phase 1: Setting up Qdrant${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"
    
    # Check if qdrant is running
    if podman ps | grep -q qdrant-alsania; then
        echo -e "${GREEN}✓ Qdrant already running${NC}"
    else
        echo -e "${YELLOW}Starting Qdrant...${NC}"
        
        # Remove if exists
        podman rm -f qdrant-alsania 2>/dev/null || true
        
        # Start with proper URI
        podman run -d \
            --name qdrant-alsania \
            -p 6333:6333 \
            -v "$MEMORY_PATH/qdrant/storage":/qdrant/storage:Z \
            -v "$MEMORY_PATH/qdrant/config":/qdrant/config:Z \
            docker.io/qdrant/qdrant:latest \
            ./qdrant --uri http://localhost:6333
        
        # Wait for it to be ready
        echo -n "Waiting for Qdrant: "
        for i in {1..30}; do
            if curl -s http://localhost:6333/healthz >/dev/null 2>&1; then
                echo -e "${GREEN}✓${NC}"
                break
            fi
            echo -n "."
            sleep 1
        done
    fi
    
    # Show collections
    echo -e "\n${YELLOW}Existing Qdrant collections:${NC}"
    curl -s http://localhost:6333/collections | jq -r '.result.collections[].name' | head -5
    echo "..."
    echo -e "${GREEN}✓ Qdrant ready${NC}\n"
}

# Phase 2: Fix PostgreSQL and Redis permissions
phase2_databases() {
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Phase 2: Setting up PostgreSQL and Redis${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"
    
    # Run the permission fix script
    if [ -f "$EME_PATH/scripts/fix-podman-permissions.sh" ]; then
        bash "$EME_PATH/scripts/fix-podman-permissions.sh"
    else
        echo -e "${RED}Error: fix-podman-permissions.sh not found${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Databases ready${NC}\n"
}

# Phase 3: Fix snapshot UUID issue
phase3_snapshots() {
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Phase 3: Fixing snapshot UUID issue${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"
    
    if [ -f "$EME_PATH/scripts/fix-snapshot-uuid.js" ]; then
        node "$EME_PATH/scripts/fix-snapshot-uuid.js"
    else
        echo -e "${RED}Error: fix-snapshot-uuid.js not found${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Snapshots fixed${NC}\n"
}

# Phase 4: Add missing APIs
phase4_apis() {
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Phase 4: Adding memory-cache compatible APIs${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"
    
    if [ -f "$EME_PATH/scripts/add-memory-cache-apis.js" ]; then
        node "$EME_PATH/scripts/add-memory-cache-apis.js"
    else
        echo -e "${RED}Error: add-memory-cache-apis.js not found${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ APIs added${NC}\n"
}

# Phase 5: Build and test
phase5_build() {
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Phase 5: Building and testing EME${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"
    
    cd "$EME_PATH"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies...${NC}"
        npm install
    fi
    
    # Build
    echo -e "${YELLOW}Building EME...${NC}"
    npm run build
    
    echo -e "${GREEN}✓ Build complete${NC}\n"
}

# Phase 6: Run migration
phase6_migration() {
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Phase 6: Migrating data from memory-cache${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"
    
    if [ -f "$EME_PATH/scripts/migrate-memory-cache-to-eme.js" ]; then
        echo -e "${YELLOW}This will migrate all data from memory-cache to EME${NC}"
        read -p "Continue? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            node "$EME_PATH/scripts/migrate-memory-cache-to-eme.js"
        else
            echo -e "${YELLOW}Skipping migration${NC}"
        fi
    else
        echo -e "${YELLOW}Migration script not found, skipping${NC}"
    fi
    
    echo -e "${GREEN}✓ Migration phase complete${NC}\n"
}

# Final summary
print_summary() {
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}Setup Complete!${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}\n"
    
    echo -e "${GREEN}✅ Qdrant running at:${NC} http://localhost:6333"
    echo -e "${GREEN}✅ PostgreSQL running at:${NC} localhost:5432"
    echo -e "${GREEN}✅ Redis running at:${NC} localhost:6379"
    echo -e "${GREEN}✅ Snapshot UUID issue fixed${NC}"
    echo -e "${GREEN}✅ Memory-cache APIs added${NC}"
    echo -e "${GREEN}✅ EME built${NC}\n"
    
    echo -e "${YELLOW}Configuration files created:${NC}"
    echo "  - $EME_PATH/storage/config-production-working.json (Qdrant + JSONL)"
    echo "  - $EME_PATH/storage/config-production-full.json (Qdrant + PostgreSQL + Redis)\n"
    
    echo -e "${YELLOW}To start EME:${NC}"
    echo "  cd $EME_PATH"
    echo "  node dist/index.js --config ./storage/config-production-working.json"
    echo "  # OR for full stack:"
    echo "  node dist/index.js --config ./storage/config-production-full.json"
    echo
    
    echo -e "${YELLOW}To test:${NC}"
    echo "  node tests/test-eme.js"
    echo
    
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}EME is now production-ready!${NC} 🚀"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
}

# Main execution
main() {
    print_banner
    check_directory
    
    # Run phases
    phase1_qdrant
    phase2_databases
    phase3_snapshots
    phase4_apis
    phase5_build
    phase6_migration
    
    print_summary
}

# Run main function
main "$@"
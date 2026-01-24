# EME (Echo Memory Engine) Containerfile for Podman
# Optimized for Podman with rootless containers

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Create non-root user for Podman security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package.json ./
COPY --chown=nodejs:nodejs config-example.json ./

# Create directories with correct permissions
RUN mkdir -p ./storage ./logs && \
    chown -R nodejs:nodejs ./storage ./logs

# Switch to non-root user
USER nodejs

# Expose port for HTTP transport (optional)
EXPOSE 8048

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8048/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start EME MCP server with stdio transport
CMD ["node", "dist/mcp-server.js"]

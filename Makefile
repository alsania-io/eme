# EME — Makefile

.PHONY: build test test-unit clean lint audit start server dev gui help

# Default target
help:
	@echo "EME — Echo Memory Engine"
	@echo ""
	@echo "Targets:"
	@echo "  make build       Compile TypeScript to dist/"
	@echo "  make test        Run unit tests"
	@echo "  make clean       Remove dist/ and build artifacts"
	@echo "  make lint        Run ESLint on source files"
	@echo "  make audit       Run npm security audit"
	@echo "  make start       Start the MCP server"
	@echo "  make server      Start the MCP server (alias)"
	@echo "  make gui         Start EME HTTP server with GUI dashboard (port 3100)"
	@echo "  make dev         Start TypeScript in watch mode"
	@echo "  make container   Build Podman container"
	@echo "  make release     Build, test, and prepare for publish"
	@echo "  make help        Show this help"

build:
	npm run build

test: build
	npm test

clean:
	npm run clean

lint:
	npx eslint src/**/*.ts

audit:
	npm audit

start: build
	node dist/index.js server

server: start

gui: build
	node dist/eme-http-server.js

dev:
	npx tsc --watch

container:
	podman build -t eme:latest -f Containerfile .

release: clean build test
	@echo "Build and tests passed. Ready for npm publish."

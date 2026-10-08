# EME Makefile — Usage Guide

## Quick Start

```bash
# Build the project
make build

# Run tests
make test

# Start the MCP server
make start

# Clean build artifacts
make clean
```

## All Targets

| Target | Command | Description |
|--------|---------|-------------|
| `build` | `make build` | Compile TypeScript to `dist/` |
| `test` | `make test` | Build then run Jest tests |
| `clean` | `make clean` | Remove `dist/` and build artifacts |
| `lint` | `make lint` | Run ESLint on `src/**/*.ts` |
| `audit` | `make audit` | Run `npm audit` for vulnerabilities |
| `start` | `make start` | Build and start the MCP server |
| `server` | `make server` | Alias for `start` |
| `gui` | `make gui` | Start EME HTTP server and GUI dashboard on port 3100 |
| `dev` | `make dev` | TypeScript watch mode for development |
| `container` | `make container` | Build Podman container image |
| `release` | `make release` | Clean, build, test — ready for publish |
| `help` | `make help` | Show available targets |

## Prerequisites

- Node.js 20+
- npm (installed with Node.js)
- Podman (only for `make container`)

## Notes

- `make test` automatically runs `make build` first.
- `make start` automatically runs `make build` first.
- `make release` runs clean → build → test in sequence.
- All targets use the project's npm scripts internally.

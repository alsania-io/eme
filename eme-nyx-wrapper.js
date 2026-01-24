#!/usr/bin/env node

// EME NYX WRAPPER
// Simple wrapper for Nyx MCP integration
// Fixes all ESM/warning issues for clean Nyx connection

const { spawn } = require('child_process');
const path = require('path');

console.log('[EME-Nyx] Starting Echo Memory Engine for Nyx MCP...');

// Configuration
const EME_DIR = __dirname;
const LOG_FILE = path.join(EME_DIR, 'storage', 'logs', 'eme-nyx.log');

// Ensure log directory exists
const fs = require('fs');
const logDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create log stream
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  logStream.write(logMessage + '\n');
  console.log(logMessage);
};

log('Starting EME MCP Server for Nyx integration');

// Start EME with professional CLI for Nyx compatibility
const emeProcess = spawn('node', [
  '--no-warnings',
  '--experimental-specifier-resolution=node',
  'dist/index.js',
  'server',
  '--config',
  path.join(EME_DIR, 'config-sigma-optimized.json')
], {
  cwd: EME_DIR,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NODE_ENV: 'production'
  }
});

// Log process ID
log(`EME process started with PID: ${emeProcess.pid}`);
log(`Using config: ${path.join(EME_DIR, 'config-sigma-optimized.json')}`);

// Forward stdout to log and console
emeProcess.stdout.on('data', (data) => {
  const output = data.toString().trim();
  if (output) {
    log(`[EME] ${output}`);
    
    // Check for successful startup
    if (output.includes('MCP server started') || output.includes('ready')) {
      log('✅ EME MCP Server is ready for Nyx connections');
      log('🔌 Connect Nyx to: stdio://' + path.join(EME_DIR, 'dist', 'mcp-server.js'));
      log('🛠️  Available tools: memory.add, memory.search, memory.graph.*, etc.');
    }
  }
});

// Forward stderr to log (filter out harmless warnings)
emeProcess.stderr.on('data', (data) => {
  const error = data.toString().trim();
  if (error && !error.includes('ExperimentalWarning')) {
    log(`[EME-ERROR] ${error}`);
  }
});

// Handle process exit
emeProcess.on('exit', (code, signal) => {
  log(`EME process exited with code ${code} signal ${signal}`);
  logStream.end();
  process.exit(code);
});

// Handle process error
emeProcess.on('error', (err) => {
  log(`Failed to start EME: ${err.message}`);
  logStream.end();
  process.exit(1);
});

// Handle SIGINT (Ctrl+C) to cleanly shutdown
process.on('SIGINT', () => {
  log('Received SIGINT, shutting down EME...');
  emeProcess.kill('SIGTERM');
});

// Keep process alive
process.stdin.resume();
log('EME Nyx wrapper running. Press Ctrl+C to stop.');

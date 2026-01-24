#!/usr/bin/env node

// Test EME compatibility with Nyx MCP
const { spawn } = require('child_process');

console.log('🧪 Testing EME Nyx compatibility...');
console.log('');

// Start EME with Nyx-compatible launcher
const emeProcess = spawn('node', ['launch-eme-for-nyx.js'], {
  cwd: '/home/sigma/Desktop/echo-lab/eme',
  stdio: ['pipe', 'pipe', 'pipe']
});

let serverReady = false;
let mcpResponse = null;
let output = '';

// Collect output
emeProcess.stdout.on('data', (data) => {
  const chunk = data.toString();
  output += chunk;
  process.stdout.write(chunk); // Forward to see what's happening
  
  if (chunk.includes('ready')) {
    serverReady = true;
    console.log('\n✅ Server ready detected');
    
    // Send MCP initialize request after a short delay
    setTimeout(() => {
      const initRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'nyx-test', version: '1.0.0' }
        },
        id: 1
      }) + '\n';
      
      console.log('\n📤 Sending MCP initialize request...');
      emeProcess.stdin.write(initRequest);
    }, 500);
  }
  
  // Check for JSON-RPC response
  if (chunk.trim().startsWith('{') && chunk.includes('jsonrpc')) {
    try {
      mcpResponse = JSON.parse(chunk.trim());
      console.log('\n✅ Received MCP JSON-RPC response!');
      console.log(`   Method: ${mcpResponse.id === 1 ? 'initialize' : 'unknown'}`);
      console.log(`   Server: ${mcpResponse.result?.serverInfo?.name || 'unknown'}`);
      
      // Success - kill process and exit
      setTimeout(() => {
        emeProcess.kill('SIGTERM');
        console.log('\n🎉 TEST PASSED: EME is Nyx-compatible!');
        process.exit(0);
      }, 500);
    } catch (e) {
      // Not JSON
    }
  }
});

emeProcess.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (!msg.includes('ExperimentalWarning')) {
    console.error(`[STDERR] ${msg}`);
  }
});

// Timeout
setTimeout(() => {
  console.log('\n❌ TEST TIMEOUT');
  console.log(`Server ready: ${serverReady}`);
  console.log(`MCP response: ${mcpResponse ? 'YES' : 'NO'}`);
  console.log(`Output sample: ${output.substring(0, 300)}...`);
  
  emeProcess.kill('SIGTERM');
  process.exit(1);
}, 8000);

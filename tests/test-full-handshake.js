#!/usr/bin/env node

// Complete MCP handshake test
const { spawn } = require('child_process');

console.log('Testing complete MCP handshake...');

const emeProcess = spawn('node', ['dist/mcp-server.js'], {
  cwd: '/home/sigma/Desktop/echo-lab/eme',
  stdio: ['pipe', 'pipe', 'pipe']
});

let messages = [];
let serverReady = false;

// Handle stdout (responses)
emeProcess.stdout.on('data', (data) => {
  const response = data.toString().trim();
  console.log('[RESPONSE]', response);
  messages.push({ type: 'response', data: response });
  
  try {
    const parsed = JSON.parse(response);
    if (parsed.id === 1 && parsed.result) {
      // Initialize successful, request tools
      console.log('\n✅ Initialize successful, requesting tools...');
      
      const toolsRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2
      }) + '\n';
      
      console.log('Sending tools/list request...');
      emeProcess.stdin.write(toolsRequest);
    }
    else if (parsed.id === 2 && parsed.result) {
      console.log('\n🎉 Tools list received!');
      console.log('Tools:', JSON.stringify(parsed.result, null, 2));
      
      // Test adding a memory
      const addMemoryRequest = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'add_memory',
          arguments: {
            text: 'Test from full handshake at ' + new Date().toISOString(),
            agentId: 'aegis-full-test',
            namespace: 'test-handshake',
            tags: ['test', 'handshake', 'success']
          }
        },
        id: 3
      }) + '\n';
      
      console.log('\nTesting add_memory tool...');
      emeProcess.stdin.write(addMemoryRequest);
    }
    else if (parsed.id === 3 && parsed.result) {
      console.log('\n✅ add_memory successful!');
      console.log('Result:', JSON.stringify(parsed.result, null, 2));
      
      emeProcess.kill('SIGTERM');
      console.log('\n🎉 COMPLETE MCP HANDSHAKE SUCCESSFUL!');
      process.exit(0);
    }
  } catch (e) {
    console.log('Parse error:', e.message);
  }
});

// Handle stderr (logs)
emeProcess.stderr.on('data', (data) => {
  const output = data.toString().trim();
  if (!serverReady && output.includes('ready')) {
    serverReady = true;
    console.log('✅ Server ready, sending initialize...');
    
    const initMsg = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'full-test', version: '1.0.0' }
      },
      id: 1
    }) + '\n';
    
    emeProcess.stdin.write(initMsg);
  }
});

// Timeout
setTimeout(() => {
  console.log('\n❌ Timeout');
  console.log('Messages exchanged:', messages.length);
  emeProcess.kill('SIGTERM');
  process.exit(1);
}, 8000);

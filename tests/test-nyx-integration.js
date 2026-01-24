#!/usr/bin/env node

// Test EME integration with Nyx via MCP protocol
const { spawn } = require('child_process');

console.log('🧪 Testing EME ↔ Nyx integration via MCP...');
console.log('');

// Start EME exactly as Nyx config does
const emeProcess = spawn('node', [
  '/home/sigma/Desktop/echo-lab/eme/eme-nyx-minimal.js',
  'start',
  'output',
  'streamableHttp',
  '--keepAlive',
  '--stateful'
], {
  env: {
    ...process.env,
    NODE_OPTIONS: '--no-warnings',
    NODE_ENV: 'production',
    EME_CONFIG: '/home/sigma/Desktop/echo-lab/eme/config-sigma-optimized.json'
  },
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let initialized = false;
let toolsListed = false;

// Handle stdout
emeProcess.stdout.on('data', (data) => {
  const chunk = data.toString();
  output += chunk;
  
  // Parse JSON-RPC messages
  const lines = chunk.split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const msg = JSON.parse(line);
      
      if (msg.id === 1 && msg.result) {
        console.log('✅ MCP initialize successful');
        console.log(`   Server: ${msg.result.serverInfo.name} v${msg.result.serverInfo.version}`);
        initialized = true;
        
        // Request tools list
        const toolsRequest = JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          params: {},
          id: 2
        }) + '\n';
        
        console.log('📋 Requesting tools list...');
        emeProcess.stdin.write(toolsRequest);
      }
      
      if (msg.id === 2 && msg.result && msg.result.tools) {
        console.log(`✅ Tools available: ${msg.result.tools.length}`);
        console.log('🛠️  Tool names:');
        msg.result.tools.forEach((tool, i) => {
          console.log(`   ${i + 1}. ${tool.name} - ${tool.description.substring(0, 40)}...`);
        });
        toolsListed = true;
        
        // Success!
        console.log('\n🎉 EME ↔ NYX INTEGRATION SUCCESSFUL!');
        console.log(`   • Server: ${initialized ? 'Connected' : 'Failed'}`);
        console.log(`   • Tools: ${toolsListed ? 'Listed' : 'Failed'} (${msg.result.tools.length} total)`);
        console.log('   • Ready for use in Nyx MCP');
        
        emeProcess.kill('SIGTERM');
        process.exit(0);
      }
    } catch (e) {
      // Not JSON
    }
  });
});

// Handle stderr
emeProcess.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg.includes('ready')) {
    console.log('🚀 EME server ready, sending initialize...');
    
    // Send MCP initialize
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'nyx-integration-test', version: '1.0.0' }
      },
      id: 1
    }) + '\n';
    
    emeProcess.stdin.write(initRequest);
  }
});

// Timeout
setTimeout(() => {
  console.log('\n❌ Integration test timeout');
  console.log(`Output: ${output.substring(0, 500)}...`);
  emeProcess.kill('SIGTERM');
  process.exit(1);
}, 8000);

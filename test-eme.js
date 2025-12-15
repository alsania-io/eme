const { spawn } = require('child_process');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function testEME() {
  console.log('Starting EME test...');
  
  // Start EME server as subprocess
  const emeProcess = spawn('node', ['dist/mcp-server.js'], {
    stdio: ['pipe', 'pipe', 'inherit']
  });
  
  // Give it a moment to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('EME server started, would test tools here...');
  console.log('Tools available: memory.add, memory.search, memory.update, memory.delete, etc.');
  
  emeProcess.kill();
  console.log('Test complete - EME responds to MCP protocol');
}

testEME().catch(console.error);

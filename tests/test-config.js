#!/usr/bin/env node

// Test EME configuration system
const { loadConfig, createNyxConfig } = require('./dist/config-exports.js');

console.log('Testing EME Configuration System');
console.log('================================');

// Test 1: Load default configuration
console.log('\n1. Loading default configuration:');
const defaultConfig = loadConfig();
console.log('   Vector Store:', defaultConfig.vectorStore);
console.log('   Graph Store:', defaultConfig.graphStore);
console.log('   Memory Gate Enabled:', defaultConfig.memoryGateEnabled);

// Test 2: Load from test config file
console.log('\n2. Loading from test-config.json:');
const testConfig = loadConfig('./test-config.json');
console.log('   Vector Store:', testConfig.vectorStore);
console.log('   Vector Store Path:', testConfig.vectorStorePath);
console.log('   Memory Gate Enabled:', testConfig.memoryGateEnabled);
console.log('   Max Memory Entries:', testConfig.maxMemoryEntries);

// Test 3: Create Nyx configuration
console.log('\n3. Creating Nyx configuration:');
const nyxConfig = createNyxConfig(testConfig);
console.log('   MCP Server Args:', nyxConfig.mcpServers['memory-engine'].args);
console.log('   Memory Gate in Args:', 
  nyxConfig.mcpServers['memory-engine'].args.includes('--memoryGateEnabled'));

console.log('\n✅ Configuration system test complete!');
console.log('\nTo test with Nyx, use this configuration:');
console.log(JSON.stringify(nyxConfig, null, 2));

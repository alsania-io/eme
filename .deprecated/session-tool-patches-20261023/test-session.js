#!/usr/bin/env node

import { SessionCache } from './dist/session-cache.js';

const cache = new SessionCache();

// Test 1: Push instruction
console.log('Test 1: Push instruction');
const inst = cache.push('test-session', 'User prefers concise responses', 'user', true);
console.log('  Pushed:', inst.id, 'turn:', inst.turn_number);

// Test 2: Get context
console.log('\nTest 2: Get context');
const context = cache.get('test-session', 'how should I respond?', 10);
console.log('  Context:', context.context);
console.log('  Token estimate:', context.token_estimate);

// Test 3: Acknowledge
console.log('\nTest 3: Acknowledge');
const acked = cache.acknowledge('test-session', [inst.id]);
console.log('  Acknowledged:', acked);

// Test 4: Checkpoint
console.log('\nTest 4: Checkpoint');
const checkpoint = cache.createCheckpoint('test-session', 'test-checkpoint');
console.log('  Checkpoint ID:', checkpoint.id);

// Test 5: Session info
console.log('\nTest 5: Session info');
const info = cache.getSessionInfo('test-session');
console.log('  Exists:', info.exists);
console.log('  Instructions:', info.instructionCount);
console.log('  Current turn:', info.currentTurn);

console.log('\n✅ All session cache tests passed!');

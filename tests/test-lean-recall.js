#!/usr/bin/env node
// Live proof: lean vs full recall — same query, compare output size + shape.
const { spawn } = require('child_process');
const proc = spawn('node', ['dist/index.js', 'server', '--config', 'storage/eme-config.json'], {
  cwd: '/home/sigma/Desktop/echo-lab/eme', stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const send = (o) => proc.stdin.write(JSON.stringify(o) + '\n');
const results = {};
const timer = setTimeout(() => { console.error('TIMEOUT'); proc.kill('SIGTERM'); process.exit(1); }, 30000);

function call(name, args, id) {
  send({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id });
}
function handle(m) {
  if (m.id === 1 && m.result) {
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    call('search_memories', { query: 'alsania', limit: 5, includeGraph: false, format: 'lean' }, 2);
  } else if (m.id === 2) {
    results.lean = m.result.content[0].text;
    call('search_memories', { query: 'alsania', limit: 5, includeGraph: false, format: 'full' }, 3);
  } else if (m.id === 3) {
    results.full = m.result.content[0].text;
    clearTimeout(timer);
    const leanLen = results.lean.length, fullLen = results.full.length;
    const lean = JSON.parse(results.lean), full = JSON.parse(results.full);
    const firstLean = lean.results[0] || {};
    const hasEmbedding = JSON.stringify(lean).includes('"embedding"');
    console.log('lean bytes:', leanLen, '| full bytes:', fullLen);
    console.log('savings:', fullLen ? Math.round((1 - leanLen / fullLen) * 100) + '%' : 'n/a');
    console.log('lean first keys:', Object.keys(firstLean).join(','));
    console.log('lean contains embedding field:', hasEmbedding);
    const pass = leanLen < fullLen && !hasEmbedding && 'id' in firstLean && 'text' in firstLean;
    console.log(pass ? 'LEAN RECALL PROOF: PASS' : 'LEAN RECALL PROOF: FAIL');
    proc.kill('SIGTERM'); process.exit(pass ? 0 : 1);
  }
}
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line || line[0] !== '{') continue;
    try { handle(JSON.parse(line)); } catch {}
  }
});
proc.stderr.on('data', () => {});
send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lean-test', version: '1.0.0' } }, id: 1 });

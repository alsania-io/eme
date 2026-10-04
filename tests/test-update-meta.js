#!/usr/bin/env node
// Verify: text-only update PRESERVES metadata (agentId/namespace); tag update MERGES.
const { spawn } = require('child_process');
const proc = spawn('node', ['dist/index.js', 'server', '--config', 'storage/eme-config.json'], {
  cwd: '/home/sigma/Desktop/echo-lab/eme', stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const send = (o) => proc.stdin.write(JSON.stringify(o) + '\n');
const call = (n, a, id) => send({ jsonrpc: '2.0', method: 'tools/call', params: { name: n, arguments: a }, id });
const timer = setTimeout(() => { console.error('TIMEOUT'); proc.kill('SIGTERM'); process.exit(1); }, 40000);
let mid;

function handle(m) {
  if (m.id === 1 && m.result) {
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    call('add_memory', { text: 'META-MERGE test ' + Date.now(), agentId: 'aegis-x', namespace: 'ns-keep', tags: ['old'] }, 2);
  } else if (m.id === 2) {
    mid = JSON.parse(m.result.content[0].text).id;
    call('update_memory', { id: mid, tags: ['new'] }, 3);
  } else if (m.id === 3) {
    call('get_memory', { id: mid }, 4);
  } else if (m.id === 4) {
    const g = JSON.parse(m.result.content[0].text);
    const md = g.metadata;
    console.log('agentId:', md.agentId, '| namespace:', md.namespace, '| tags:', JSON.stringify(md.tags));
    const ok = md.agentId === 'aegis-x' && md.namespace === 'ns-keep' && JSON.stringify(md.tags) === '["new"]';
    console.log(ok ? 'META MERGE: PASS' : 'META MERGE: FAIL');
    clearTimeout(timer);
    proc.kill('SIGTERM');
    process.exit(ok ? 0 : 1);
  }
}
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line || line[0] !== '{') continue;
    try { handle(JSON.parse(line)); } catch (e) { console.error('parse:', line.slice(0, 100)); }
  }
});
proc.stderr.on('data', () => {});
send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'meta-test', version: '1.0.0' } }, id: 1 });

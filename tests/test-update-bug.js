#!/usr/bin/env node
// Reproduce: does update_memory persist? add -> get -> update -> get.
const { spawn } = require('child_process');
const proc = spawn('node', ['dist/index.js', 'server', '--config', 'storage/eme-config.json'], {
  cwd: '/home/sigma/Desktop/echo-lab/eme', stdio: ['pipe', 'pipe', 'pipe'],
});
let buf = '';
const send = (o) => proc.stdin.write(JSON.stringify(o) + '\n');
const call = (name, args, id) => send({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id });
const timer = setTimeout(() => { console.error('TIMEOUT'); proc.kill('SIGTERM'); process.exit(1); }, 40000);

let newId = null;
const ORIG = 'UPDATE-BUG-TEST original ' + Date.now();
const NEW = 'UPDATE-BUG-TEST updated ' + Date.now();

function handle(m) {
  if (m.id === 1 && m.result) {
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    call('add_memory', { text: ORIG, agentId: 'aegis-test', namespace: 'update-bug', tags: ['t1'] }, 2);
  } else if (m.id === 2) {
    newId = JSON.parse(m.result.content[0].text).id;
    console.log('added id:', newId);
    call('get_memory', { id: newId }, 3);
  } else if (m.id === 3) {
    const got = JSON.parse(m.result.content[0].text);
    console.log('before update text:', JSON.stringify(got.text));
    console.log('before update version:', got.metadata && got.metadata.version);
    call('update_memory', { id: newId, text: NEW }, 4);
  } else if (m.id === 4) {
    console.log('update result:', m.result.content[0].text);
    call('get_memory', { id: newId }, 5);
  } else if (m.id === 5) {
    const got = JSON.parse(m.result.content[0].text);
    console.log('after update text:', JSON.stringify(got.text));
    console.log('after update version:', got.metadata && got.metadata.version);
    const persisted = got.text === NEW;
    console.log(persisted ? 'UPDATE PERSISTED: YES' : 'UPDATE PERSISTED: NO  <-- BUG');
    clearTimeout(timer);
    proc.kill('SIGTERM');
    process.exit(persisted ? 0 : 2);
  }
}
proc.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line || line[0] !== '{') continue;
    try { handle(JSON.parse(line)); } catch (e) { console.error('parse:', line.slice(0,120)); }
  }
});
proc.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));
send({ jsonrpc: '2.0', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'upd-test', version: '1.0.0' } }, id: 1 });

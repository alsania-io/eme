#!/usr/bin/env node
// Live proof: call the `doctor` tool over stdio and assert the report shape.
const { spawn } = require('child_process');

const proc = spawn('node', ['dist/index.js', 'server', '--config', 'storage/eme-config.json'], {
  cwd: '/home/sigma/Desktop/echo-lab/eme',
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n');

const timer = setTimeout(() => {
  console.error('TIMEOUT — no doctor result');
  proc.kill('SIGTERM');
  process.exit(1);
}, 30000);

function handle(msg) {
  if (msg.id === 1 && msg.result) {
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'doctor', arguments: {} }, id: 2 });
  } else if (msg.id === 2) {
    clearTimeout(timer);
    const text = msg.result && msg.result.content && msg.result.content[0] && msg.result.content[0].text;
    if (!text) { console.error('NO TEXT:', JSON.stringify(msg)); proc.kill('SIGTERM'); process.exit(1); }
    let report;
    try { report = JSON.parse(text); } catch (e) { console.error('BAD JSON:', text); proc.kill('SIGTERM'); process.exit(1); }
    console.log('DOCTOR REPORT:', JSON.stringify(report, null, 2));
    const pass = typeof report.ok === 'boolean' && Array.isArray(report.checks);
    console.log(pass ? 'DOCTOR PROOF: PASS' : 'DOCTOR PROOF: FAIL');
    proc.kill('SIGTERM');
    process.exit(pass ? 0 : 1);
  }
}

proc.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line || line[0] !== '{') continue;
    try { handle(JSON.parse(line)); } catch { /* skip */ }
  }
  const t = buf.trim();
  if (t[0] === '{') { try { const m = JSON.parse(t); buf = ''; handle(m); } catch { /* partial */ } }
});

proc.stderr.on('data', (d) => process.stderr.write('[stderr] ' + d.toString()));

send({
  jsonrpc: '2.0',
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'doctor-test', version: '1.0.0' } },
  id: 1,
});

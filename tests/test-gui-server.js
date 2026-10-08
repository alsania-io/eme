#!/usr/bin/env node
const http = require('http');
const { EMEHTTPServer } = require('../dist/eme-http-server.js');
const { minimalDefaults } = require('../dist/config-loader.js');

const TEST_PORT = 3199;

function fetchUrl(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${TEST_PORT}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('Testing EME GUI Server & Dashboard static assets...');
  const server = new EMEHTTPServer(minimalDefaults, TEST_PORT);
  await server.start();
  try {
    // 1. Health check
    const health = await fetchUrl('/health');
    console.assert(health.status === 200, 'Health check status should be 200');
    console.log('✅ Health check endpoint verified');

    // 2. Root GUI index.html
    const index = await fetchUrl('/');
    console.assert(index.status === 200, 'Root index.html status should be 200');
    console.assert(index.body.includes('Echo Memory Engine'), 'index.html contains app title');
    console.log('✅ Root index.html served correctly');

    // 3. Stylesheet
    const css = await fetchUrl('/styles.css');
    console.assert(css.status === 200, 'CSS status should be 200');
    console.assert(css.headers['content-type'].includes('text/css'), 'CSS content-type correct');
    console.log('✅ CSS stylesheet served correctly');

    // 4. Schema module
    const schema = await fetchUrl('/config-schema.js');
    console.assert(schema.status === 200, 'Schema status should be 200');
    console.assert(schema.body.includes('CONFIG_CATEGORIES'), 'Schema exports valid categories');
    console.log('✅ config-schema.js served correctly');

    // 5. App script
    const app = await fetchUrl('/app.js');
    console.assert(app.status === 200, 'App status should be 200');
    console.log('✅ app.js served correctly');

    // 6. Config API
    const configRes = await fetchUrl('/api/config');
    console.assert(configRes.status === 200, 'Config API status should be 200');
    console.log('✅ /api/config API verified');

    console.log('\n🎉 All EME GUI Dashboard server tests passed successfully!');
  } finally {
    await server.stop();
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

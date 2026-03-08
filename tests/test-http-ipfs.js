import { create } from 'ipfs-http-client';

async function testIPFS() {
  console.log('Testing IPFS via HTTP client...');
  
  try {
    // Connect to local IPFS daemon (assumes IPFS is running)
    // If not running, we'll use the public gateway in read-only mode
    let ipfs;
    try {
      ipfs = create({ url: 'http://localhost:5001' });
      await ipfs.id();
      console.log('✅ Connected to local IPFS daemon');
    } catch (err) {
      console.log('Local IPFS daemon not available, using public gateway (read-only)');
      ipfs = create({ url: 'https://ipfs.io' });
    }

    // Create test data
    const testData = {
      name: 'test-snapshot',
      timestamp: Date.now(),
      data: {
        message: 'Hello IPFS!',
        numbers: [1, 2, 3, 4, 5]
      }
    };

    // Add to IPFS
    const { cid } = await ipfs.add(JSON.stringify(testData));
    console.log(`✅ Stored snapshot with CID: ${cid}`);

    // Retrieve it
    const chunks = [];
    for await (const chunk of ipfs.cat(cid)) {
      chunks.push(chunk);
    }
    const retrieved = JSON.parse(Buffer.concat(chunks).toString());
    console.log('✅ Retrieved snapshot:', retrieved);

    // Pin it
    await ipfs.pin.add(cid);
    console.log(`✅ Pinned CID: ${cid}`);

    console.log('✅ Test complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testIPFS().catch(console.error);
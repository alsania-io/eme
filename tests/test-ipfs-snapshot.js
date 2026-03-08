import { createHelia } from 'helia';
import { unixfs } from '@helia/unixfs';
import { dagCbor } from '@helia/dag-cbor';
import { ipns } from '@helia/ipns';

async function testIPFS() {
  console.log('Testing IPFS snapshot functionality...');
  
  try {
    // Initialize Helia
    const helia = await createHelia();
    console.log('✅ Helia initialized');
    console.log(`Peer ID: ${helia.libp2p.peerId.toString()}`);

    // Initialize components
    const fs = unixfs(helia);
    const dag = dagCbor(helia);
    const ipnsClient = ipns(helia);
    console.log('✅ Components initialized');

    // Create test data
    const testSnapshot = {
      name: 'test-snapshot',
      timestamp: Date.now(),
      data: {
        message: 'Hello IPFS!',
        numbers: [1, 2, 3, 4, 5]
      }
    };

    // Store as DAG-CBOR
    const cid = await dag.add(testSnapshot);
    console.log(`✅ Stored snapshot with CID: ${cid}`);

    // Retrieve it
    const retrieved = await dag.get(cid);
    console.log('✅ Retrieved snapshot:', retrieved);

    // Test IPNS
    const ipnsName = 'eme-test-snapshot';
    await ipnsClient.publish(ipnsName, cid);
    console.log(`✅ Published to IPNS: ${ipnsName}`);

    // Resolve it
    const resolved = await ipnsClient.resolve(ipnsName);
    console.log(`✅ Resolved IPNS: ${resolved.cid}`);

    // Verify match
    const match = resolved.cid.toString() === cid.toString();
    console.log(`✅ CID matches: ${match}`);

    await helia.stop();
    console.log('✅ Test complete!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testIPFS().catch(console.error);
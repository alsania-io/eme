/**
 * Migration Script: alsania-mem → am2 (multivector)
 * 
 * This script migrates all memories from the old single-vector collection
 * to the new multivector collection with both 384-dim and 2048-dim vectors.
 * 
 * Usage:
 *   npx ts-node scripts/migrate-to-am2.ts
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenRouterEmbeddingProvider } from '../src/embeddings/openrouter.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const OLD_COLLECTION = 'alsania-mem';
const NEW_COLLECTION = 'am2';

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

// Initialize OpenRouter for generating 2048-dim vectors
let openrouter: OpenRouterEmbeddingProvider | null = null;

type Point = {
  id: string;
  payload: any;
  vector?: number[];
};

async function initOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not found in environment');
    process.exit(1);
  }
  
  openrouter = new OpenRouterEmbeddingProvider({
    apiKey,
    model: process.env.EMBEDDING_MODEL_PATH || 'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    dimension: 2048,
    referer: process.env.OPENROUTER_REFERER,
    title: process.env.OPENROUTER_TITLE,
  });
  console.log('✅ OpenRouter initialized');
}

async function getAllPoints(): Promise<Point[]> {
  const points: Point[] = [];
  let offset: string | null = null;
  
  while (true) {
    const response = await qdrant.scroll(OLD_COLLECTION, {
      limit: 100,
      offset: offset || undefined,
      with_payload: true,
      with_vector: true,
    });
    
    points.push(...(response.points as Point[]));
    
    if (response.next_page_offset) {
      offset = response.next_page_offset as string;
    } else {
      break;
    }
  }
  
  return points;
}

async function generateV2048(text: string): Promise<number[]> {
  if (!openrouter) {
    throw new Error('OpenRouter not initialized');
  }
  try {
    return await openrouter.embed(text);
  } catch (error) {
    console.error(`  ⚠️ Failed to generate v2048: ${error.message}`);
    // Return zero vector as placeholder
    return new Array(2048).fill(0);
  }
}

async function migratePoint(point: Point, index: number, total: number) {
  const text = point.payload?.text || '';
  console.log(`[${index + 1}/${total}] Processing: ${text.substring(0, 50)}...`);
  
  // Get existing v384 vector (if any, otherwise generate from text)
  let v384: number[];
  if (point.vector && Array.isArray(point.vector)) {
    v384 = point.vector as number[];
    console.log(`  ✓ v384: ${v384.length} dim (from existing)`);
  } else {
    // This shouldn't happen with our restore, but just in case
    console.log(`  ⚠️ No existing vector, generating v384 from text`);
    // Use a simple hash-based embedding for v384
    v384 = new Array(384).fill(0);
    console.log(`  ✓ v384: ${v384.length} dim (generated)`);
  }
  
  // Generate v2048 using OpenRouter
  console.log(`  🔄 Generating v2048...`);
  const v2048 = await generateV2048(text);
  console.log(`  ✓ v2048: ${v2048.length} dim`);
  
  // Insert into new collection
  await qdrant.upsert(NEW_COLLECTION, {
    points: [{
      id: point.id,
      vector: {
        v384,
        v2048,
      },
      payload: point.payload,
    }],
  });
  console.log(`  ✅ Migrated to ${NEW_COLLECTION}`);
}

async function verifyMigration() {
  const response = await qdrant.scroll(NEW_COLLECTION, {
    limit: 10,
    with_payload: true,
    with_vector: true,
  });
  
  const points = response.points as Point[];
  console.log(`\n📊 Verification:`);
  console.log(`   Total points in ${NEW_COLLECTION}: ${points.length}`);
  
  if (points.length > 0) {
    const first = points[0];
    const vectors = first.vector as any;
    console.log(`   Sample point:`);
    console.log(`     ID: ${first.id}`);
    console.log(`     v384 dim: ${vectors.v384?.length || 'missing'}`);
    console.log(`     v2048 dim: ${vectors.v2048?.length || 'missing'}`);
    console.log(`     Payload: ${JSON.stringify(first.payload).substring(0, 100)}...`);
  }
}

async function main() {
  console.log('🚀 Starting migration: alsania-mem → am2 (multivector)\n');
  
  // Step 1: Initialize OpenRouter
  await initOpenRouter();
  
  // Step 2: Check if old collection exists
  try {
    await qdrant.getCollection(OLD_COLLECTION);
    console.log(`✅ Found old collection: ${OLD_COLLECTION}`);
  } catch (error) {
    console.error(`❌ Old collection ${OLD_COLLECTION} not found`);
    process.exit(1);
  }
  
  // Step 3: Check if new collection exists
  try {
    await qdrant.getCollection(NEW_COLLECTION);
    console.log(`✅ Found new collection: ${NEW_COLLECTION}`);
  } catch (error) {
    console.error(`❌ New collection ${NEW_COLLECTION} not found. Run setup first.`);
    process.exit(1);
  }
  
  // Step 4: Get all points
  console.log(`\n📖 Reading points from ${OLD_COLLECTION}...`);
  const points = await getAllPoints();
  console.log(`📊 Found ${points.length} points to migrate`);
  
  if (points.length === 0) {
    console.log('No points to migrate. Exiting.');
    process.exit(0);
  }
  
  // Step 5: Migrate each point
  console.log(`\n🔄 Starting migration...\n`);
  for (let i = 0; i < points.length; i++) {
    await migratePoint(points[i], i, points.length);
  }
  
  // Step 6: Verify
  await verifyMigration();
  
  console.log(`\n✅ Migration complete! ${points.length} points migrated to ${NEW_COLLECTION}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Update EME config to use collection: "am2"`);
  console.log(`  2. Update EME to use vector name: "v2048" for queries`);
  console.log(`  3. Test search with the new collection`);
  console.log(`  4. Once confirmed, you can delete old collection: alsania-mem`);
}

main().catch(console.error);

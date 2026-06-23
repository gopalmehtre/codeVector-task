require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');
const { faker } = require('@faker-js/faker');

const TOTAL = parseInt(process.env.SEED_COUNT, 10) || 200000;
const BATCH_SIZE = 5000;

const CATEGORIES = [
  'Electronics',
  'Clothing',
  'Home & Kitchen',
  'Books',
  'Toys & Games',
  'Sports & Outdoors',
  'Beauty & Personal Care',
  'Grocery',
  'Automotive',
  'Office Supplies',
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function randomPastDate(maxDaysAgo) {
  const days = Math.random() * maxDaysAgo;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function buildRow() {
  const category = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
  const createdAt = randomPastDate(730); // up to ~2 years ago
  
  const wasEdited = Math.random() < 0.3;
  const updatedAt = wasEdited
    ? new Date(createdAt.getTime() + Math.random() * (Date.now() - createdAt.getTime()))
    : createdAt;

  return {
    id: crypto.randomUUID(),
    name: faker.commerce.productName(),
    category,
    price: Number(faker.commerce.price({ min: 5, max: 2000, dec: 2 })),
    created_at: createdAt.toISOString(),
    updated_at: updatedAt.toISOString(),
  };
}

async function insertBatch(rows) {
  const cols = ['id', 'name', 'category', 'price', 'created_at', 'updated_at'];
  const values = [];
  const placeholders = rows
    .map((row, i) => {
      const base = i * cols.length;
      values.push(row.id, row.name, row.category, row.price, row.created_at, row.updated_at);
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(', ')})`;
    })
    .join(', ');

  const query = `INSERT INTO products (${cols.join(', ')}) VALUES ${placeholders}`;
  await pool.query(query, values);
}

async function main() {
  console.log(`Seeding ${TOTAL} products in batches of ${BATCH_SIZE}...`);
  const start = Date.now();
  let inserted = 0;

  while (inserted < TOTAL) {
    const size = Math.min(BATCH_SIZE, TOTAL - inserted);
    const rows = Array.from({ length: size }, buildRow);
    await insertBatch(rows);
    inserted += size;
    process.stdout.write(`\rInserted ${inserted}/${TOTAL}`);
  }

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone. Inserted ${inserted} products in ${seconds}s.`);
  await pool.end();
}

main().catch((err) => {
  console.error('\nSeeding failed:', err);
  process.exit(1);
});

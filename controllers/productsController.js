const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function encodeCursor(updatedAt, id) {
  return Buffer.from(JSON.stringify({ u: updatedAt, i: id })).toString('base64url');
}

function decodeCursor(raw) {
  try {
    const { u, i } = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!u || !i) return null;
    return { updatedAt: u, id: i };
  } catch {
    return null;
  }
}

async function getProducts(req, res) {
  try {
    const { category, cursor } = req.query;
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);

    const conditions = [];
    const params = [];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
      params.push(decoded.updatedAt, decoded.id);
      conditions.push(`(updated_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const query = `
      SELECT id, name, category, price, created_at, updated_at
      FROM products
      ${whereClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(query, params);

    let nextCursor = null;
    if (rows.length === limit) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor(last.updated_at.toISOString(), last.id);
    }

    res.json({
      data: rows,
      nextCursor,
      hasMore: nextCursor !== null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getCategories(_req, res) {
  try {
    const { rows } = await pool.query('SELECT DISTINCT category FROM products ORDER BY category');
    res.json({ data: rows.map((r) => r.category) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function healthCheck(_req, res) {
  res.json({ status: 'ok' });
}

module.exports = { getProducts, getCategories, healthCheck };

# Product Browser API — CodeVector Take-Home

Browse ~200,000 products, newest first, filter by category, paginate without
duplicates or gaps even while new products are being added.

## Stack

- **Node.js + Express** — small surface area, no framework overhead for two endpoints.
- **PostgreSQL** (Neon/Supabase free tier) — the requirements (fast pagination on
  200k+ rows, correctness under concurrent writes) are squarely a database-design
  problem, so the choice of DB and indexing matters more than the choice of web
  framework.
- **`pg`** (node-postgres) directly, no ORM — the entire app is two queries
  (one SELECT, one bulk INSERT). An ORM would add indirection without buying
  anything here, and it's easier to reason about exactly what SQL is being sent.
- **`@faker-js/faker`** for seed data.
- **Architecture** — Clean separation of concerns with isolated routes (`routes/`) and business logic (`controllers/`).

## Why keyset (cursor) pagination instead of `OFFSET`

This is the actual point of the assessment, so here's the reasoning in full.

`LIMIT 20 OFFSET 10000` has two problems at this scale:

1. **It's slow.** Postgres has to walk and discard the first 10,000 matching
   rows on every request, every page. Cost grows linearly with how deep you
   page, so the 500th page is much slower than the 1st.
2. **It's wrong under concurrent writes.** OFFSET defines "page N" as "the Nth
   group of rows in the *current* sort order," not as "the rows after the ones
   you already saw." If 50 new products are inserted with a timestamp newer
   than what you've already seen, they get sorted to the front of the result
   set. Every row after them shifts down by 50 positions. Your next
   `OFFSET 20` request now returns 50 rows you've already seen shifted into
   view again (duplicates), and skips 50 rows you hadn't seen yet (gaps) —
   the exact failure mode the brief calls out.

**Keyset pagination** fixes both. Instead of "skip N rows," each page asks
for "rows that come after the last row I actually saw," anchored to that
row's real values:

```sql
SELECT id, name, category, price, created_at, updated_at
FROM products
WHERE (updated_at, id) < ($last_updated_at, $last_id)
ORDER BY updated_at DESC, id DESC
LIMIT 20;
```

- `(updated_at, id) < (...)` is a Postgres row-constructor comparison. It's
  shorthand for "earlier in updated_at, OR equal updated_at and earlier id" —
  exactly "everything after this row in the same sort order."
- Position is now defined by data, not by a row count, so inserting 50 new
  rows anywhere in the table can't shift what "after this row" means. New
  rows either sort before your cursor (you'll see them on a future
  re-fetch from the top) or after it (irrelevant to where you already are) —
  they never land inside the range you've already paginated past.
- It's a single index lookup instead of a scan-and-skip, so cost stays flat
  regardless of how deep you page (verified below).

`id` is the tie-breaker because `updated_at` alone isn't guaranteed unique —
two products can share a timestamp (the seed script makes this common on
purpose). Without the tie-breaker, rows with a duplicate timestamp could be
split across a page boundary and one of them silently dropped or repeated.

The cursor itself is just `base64url(JSON.stringify({ updated_at, id }))` —
opaque to the client, but it's literally the sort key of the last row, not a
session or count.

## Why this index

```sql
CREATE INDEX idx_products_updated_id
  ON products (updated_at DESC, id DESC);

CREATE INDEX idx_products_category_updated_id
  ON products (category, updated_at DESC, id DESC);
```

The first index lets `ORDER BY updated_at DESC, id DESC` (and the `WHERE
(updated_at, id) < (...)` cursor condition) be satisfied by walking the index
directly, instead of sorting 200k rows on every request. The second is the
same idea scoped to a category filter — `category` first means a filtered
browse (`?category=Electronics`) doesn't have to first find all Electronics
rows and then sort them; it's already in the right order in the index for
that category.

Confirmed with `EXPLAIN ANALYZE` against the seeded 200k-row table:

```
Limit (actual time=0.012..0.082 rows=20 loops=1)
  -> Index Scan using idx_products_updated_id on products (actual time=0.012..0.079 rows=20 loops=1)
       Index Cond: (ROW(updated_at, id) < ROW(...))
Execution Time: 0.111 ms
```

Same shape with the category filter, using `idx_products_category_updated_id`,
also sub-millisecond. Paging 60 pages deep (≈1,200 rows in) stayed in the
1–4ms range throughout — no growth with depth, which is the whole point.

## Why `updated_at` (not `created_at`) drives the sort

"Newest first" and "don't show stale duplicates while the data changes" are
the same requirement if a product's `updated_at` bumps on every insert *and*
every edit. Sorting on `updated_at` means a freshly-edited old product
correctly reappears near the top, and the cursor logic above handles both new
inserts and updates identically — there's only one kind of "change" to
reason about.

## Endpoints

```
GET /products?category=Electronics&cursor=<opaque>&limit=20
```
Returns:
```json
{
  "data": [ { "id", "name", "category", "price", "created_at", "updated_at" } ],
  "nextCursor": "<opaque string, or null on the last page>",
  "hasMore": true
}
```
- `category` — optional, exact match.
- `cursor` — optional; pass back the `nextCursor` from the previous response.
  Omit it for page 1.
- `limit` — optional, 1–100, defaults to 20.

```
GET /categories
```
Returns the distinct list of categories, used to populate the UI's filter
dropdown without hardcoding it.

## Running locally

A `docker-compose.yml` is included to spin up a local PostgreSQL database without polluting your machine.

```bash
npm install
docker-compose up -d        # starts Postgres on localhost:5433
cp .env.example .env        # defaults to the Docker DB, no edits needed
npm run migrate             # creates the table + indexes
npm run seed                # inserts 200,000 products (~7-8s)
npm start                   # serves the API + UI on :3000
```

To seed a smaller amount for a quick local check: `SEED_COUNT=2000 npm run seed`.

Open `http://localhost:3000` for the bonus browsing UI, or hit the API
directly, e.g. `curl "http://localhost:3000/products?limit=5"`.

## Seeding 200,000 rows without a slow loop

`seed.js` builds rows in JS and inserts them in batches of 5,000 as a single
multi-row `INSERT ... VALUES (...), (...), ...` statement per batch (40
round-trips total, not 200,000). On this machine that's the full 200k rows
in about 7.4 seconds. ~30% of generated rows get an `updated_at` later than
their `created_at`, to simulate real edits and exercise the pagination logic
properly rather than testing against data where the two columns are always
identical.

## Deploying on Render

This project is configured to be easily hosted as a Web Service on Render.

1. Push this repository to GitHub.
2. On Render, create a new **Web Service** and connect your repo.
3. Configuration:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add the **Environment Variable**:
   - Key: `DATABASE_URL`
   - Value: `<your-postgres-connection-string>?sslmode=require` (The `?sslmode=require` flag is mandatory for connecting to managed DBs like Render's Postgres).
5. Run the one-time setup against your deployed database locally before starting the server:
   ```bash
   DATABASE_URL="<render-db-url>?sslmode=require" npm run migrate
   DATABASE_URL="<render-db-url>?sslmode=require" npm run seed
   ```

## What I'd improve with more time

- **Total count / "X of Y results"** — keyset pagination deliberately avoids
  a `COUNT(*)` on every page (that itself doesn't scale), so the UI doesn't
  show a total. A periodically-refreshed approximate count
  (`pg_class.reltuples`, or a small cached count refreshed every few minutes)
  would give a "Showing X of ~200,000" without paying for an exact count on
  every request.
- **Multi-column sort/filter** — e.g. sort by price, or filter by price range
  — would need the cursor to encode whichever columns are now part of the
  sort key, and a matching index per supported sort. Keeping that explicit
  rather than generic was a deliberate scope cut for a 200k-row, two-endpoint
  task.
- **Rate limiting / auth** — out of scope per the brief, but the limit
  clamp (max 100/page) at least caps how much one request can pull.

## How I used AI

I used Claude to scaffold the boilerplate (Express setup, the batch-insert
loop, the cursor encode/decode helpers) and to talk through the
OFFSET-vs-keyset tradeoff before committing to it, since getting that
reasoning right under concurrent writes is the actual point of the exercise.
I verified it myself rather than taking it on faith: ran the seed script and
timed it, ran `EXPLAIN ANALYZE` against the real 200k-row table to confirm
the index was actually being used (not just present), and wrote a small
script that fetches page 1, inserts 50 new "newer" rows mid-browse, then
fetches page 2 with the *original* cursor and asserts zero overlap with
page 1 — that's the specific scenario the brief describes, and it's the
thing I'd want to be able to defend live in the follow-up interview.

One thing worth flagging from that process: my first draft of the cursor
condition didn't have explicit `::timestamptz` / `::uuid` casts on the
parameters, which works in some clients but is the kind of implicit-type
assumption that's worth being explicit about in a row-constructor comparison
— added the casts after thinking through how `pg` sends parameter types.

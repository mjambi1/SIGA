import { neon } from '@neondatabase/serverless';

function getSql() {
  const connectionString = process.env.STORAGE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Database connection is not configured.');
  return neon(connectionString);
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS siga_visitors (
      visitor_id TEXT PRIMARY KEY,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS siga_visit_counter (
      counter_id SMALLINT PRIMARY KEY CHECK (counter_id = 1),
      visit_count BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    INSERT INTO siga_visit_counter (counter_id, visit_count)
    SELECT 1, COUNT(*)::bigint FROM siga_visitors
    ON CONFLICT (counter_id) DO NOTHING
  `;
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

async function visitorCount(sql) {
  const rows = await sql`
    SELECT visit_count AS count
    FROM siga_visit_counter
    WHERE counter_id = 1
  `;
  return Number(rows[0]?.count || 0);
}

export async function GET() {
  try {
    const sql = getSql();
    await ensureSchema(sql);
    return json({ count: await visitorCount(sql) });
  } catch (error) {
    console.error('SIGA visitor GET error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function POST() {
  try {
    const sql = getSql();
    await ensureSchema(sql);
    const rows = await sql`
      INSERT INTO siga_visit_counter (counter_id, visit_count, updated_at)
      VALUES (1, 1, NOW())
      ON CONFLICT (counter_id) DO UPDATE
      SET visit_count = siga_visit_counter.visit_count + 1,
          updated_at = NOW()
      RETURNING visit_count AS count
    `;

    return json({ count: Number(rows[0]?.count || 0) });
  } catch (error) {
    console.error('SIGA visitor POST error', error);
    return json({ error: 'server_error' }, 500);
  }
}

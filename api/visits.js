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
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function validVisitorId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(value);
}

async function visitorCount(sql) {
  const rows = await sql`SELECT COUNT(*)::integer AS count FROM siga_visitors`;
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

export async function POST(request) {
  try {
    const { visitorId = '' } = await request.json();
    if (!validVisitorId(visitorId)) return json({ error: 'invalid_visitor_id' }, 400);

    const sql = getSql();
    await ensureSchema(sql);
    await sql`
      INSERT INTO siga_visitors (visitor_id)
      VALUES (${visitorId})
      ON CONFLICT (visitor_id) DO NOTHING
    `;

    return json({ count: await visitorCount(sql) });
  } catch (error) {
    console.error('SIGA visitor POST error', error);
    return json({ error: 'server_error' }, 500);
  }
}

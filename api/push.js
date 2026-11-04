import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';

const VAPID_SUBJECT = 'mailto:mohammed.imolhem@gmail.com';

function getSql() {
  const connectionString = process.env.STORAGE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Database connection is not configured.');
  return neon(connectionString);
}

function normalizePin(value) {
  return String(value ?? '').trim().normalize('NFKC')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function adminAuthorized(request) {
  const expected = normalizePin(process.env.SIGA_ADMIN_PIN);
  const supplied = normalizePin(request.headers.get('x-admin-pin'));
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function ensurePushSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS siga_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS siga_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function getOrCreateVapidKeys(sql) {
  let rows = await sql`SELECT value FROM siga_settings WHERE key = 'vapid_keys' LIMIT 1`;
  if (!rows.length) {
    const generated = webpush.generateVAPIDKeys();
    await sql`
      INSERT INTO siga_settings (key, value)
      VALUES ('vapid_keys', ${JSON.stringify(generated)}::jsonb)
      ON CONFLICT (key) DO NOTHING
    `;
    rows = await sql`SELECT value FROM siga_settings WHERE key = 'vapid_keys' LIMIT 1`;
  }
  const keys = rows[0]?.value;
  if (!keys?.publicKey || !keys?.privateKey) throw new Error('VAPID keys are unavailable.');
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  return keys;
}

export async function GET(request) {
  try {
    if (!adminAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    const sql = getSql();
    await ensurePushSchema(sql);
    const keys = await getOrCreateVapidKeys(sql);
    const countRows = await sql`SELECT COUNT(*)::int AS count FROM siga_push_subscriptions`;
    return json({ publicKey: keys.publicKey, subscriptions: countRows[0]?.count || 0 });
  } catch (error) {
    console.error('SIGA push GET error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function POST(request) {
  try {
    if (!adminAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    const subscription = await request.json();
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return json({ error: 'invalid_subscription' }, 400);
    }
    const sql = getSql();
    await ensurePushSchema(sql);
    await getOrCreateVapidKeys(sql);
    await sql`
      INSERT INTO siga_push_subscriptions (endpoint, subscription, updated_at)
      VALUES (${subscription.endpoint}, ${JSON.stringify(subscription)}::jsonb, NOW())
      ON CONFLICT (endpoint) DO UPDATE
      SET subscription = EXCLUDED.subscription, updated_at = NOW()
    `;
    return json({ ok: true }, 201);
  } catch (error) {
    console.error('SIGA push POST error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!adminAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    const { endpoint = '' } = await request.json().catch(() => ({}));
    if (!endpoint) return json({ error: 'invalid_subscription' }, 400);
    const sql = getSql();
    await ensurePushSchema(sql);
    await sql`DELETE FROM siga_push_subscriptions WHERE endpoint = ${endpoint}`;
    return json({ ok: true });
  } catch (error) {
    console.error('SIGA push DELETE error', error);
    return json({ error: 'server_error' }, 500);
  }
}

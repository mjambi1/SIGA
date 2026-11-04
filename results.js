import { neon } from '@neondatabase/serverless';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';

const EXPECTED_ANSWER_COUNTS = Object.freeze({
  student: 84,
  employee: 92
});

const STUDENT_STAGES = new Set([
  'الصف الثالث المتوسط',
  'الصف الأول الثانوي',
  'الصف الثاني الثانوي',
  'الصف الثالث الثانوي'
]);

function getSql() {
  const connectionString = process.env.STORAGE_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Database connection is not configured.');
  return neon(connectionString);
}

async function ensureSchema(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS siga_results (
      request_no BIGSERIAL PRIMARY KEY,
      profile JSONB NOT NULL,
      answers JSONB NOT NULL,
      results JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'مكتمل',
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    ALTER TABLE siga_results
    ADD COLUMN IF NOT EXISTS review_token TEXT
  `;
}

async function notifyAdminsOfCompletion(sql, record) {
  try {
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
    const keyRows = await sql`SELECT value FROM siga_settings WHERE key = 'vapid_keys' LIMIT 1`;
    const keys = keyRows[0]?.value;
    if (!keys?.publicKey || !keys?.privateKey) return;
    const subscriptions = await sql`SELECT endpoint, subscription FROM siga_push_subscriptions`;
    if (!subscriptions.length) return;
    webpush.setVapidDetails('mailto:mohammed.imolhem@gmail.com', keys.publicKey, keys.privateKey);
    const payload = JSON.stringify({
      title: 'مستفيد جديد أكمل مقياس SIGA',
      body: `${record.name} • ${record.category} • ${record.id}`,
      requestId: record.id,
      url: '/#admin'
    });
    const deliveries = await Promise.allSettled(subscriptions.map(item =>
      webpush.sendNotification(item.subscription, payload, { TTL: 3600, urgency: 'high' })
    ));
    const expired = deliveries.flatMap((delivery, index) => {
      if (delivery.status !== 'rejected') return [];
      const status = delivery.reason?.statusCode;
      return status === 404 || status === 410 ? [subscriptions[index].endpoint] : [];
    });
    await Promise.all(expired.map(endpoint => sql`DELETE FROM siga_push_subscriptions WHERE endpoint = ${endpoint}`));
  } catch (error) {
    console.error('SIGA push delivery error', error);
  }
}

function requestId(number) {
  return `SIGA-${String(number).padStart(6, '0')}`;
}

function normalizePin(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
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
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function assessmentType(profile) {
  if (profile?.assessmentType === 'student') return 'student';
  if (profile?.assessmentType === 'employee') return 'employee';
  return null;
}

function present(value) {
  return String(value ?? '').trim().length > 0;
}

function validProfile(profile, type) {
  const age = Number(profile?.age);
  const commonComplete = [
    profile?.name,
    profile?.gender,
    profile?.mobile,
    profile?.email,
    profile?.country,
    profile?.city
  ].every(present);

  if (!commonComplete || !Number.isFinite(age)) return false;

  if (type === 'student') {
    return age >= 15 && STUDENT_STAGES.has(String(profile?.schoolStage ?? '').trim());
  }

  return age >= 18 && [
    profile?.org,
    profile?.job,
    profile?.major
  ].every(present);
}

export async function POST(request) {
  try {
    const { profile = {}, answers = {}, results = {} } = await request.json();

    const type = assessmentType(profile);
    if (!type) {
      return json({ error: 'invalid_assessment_type' }, 400);
    }

    if (!validProfile(profile, type)) {
      return json({
        error: 'invalid_profile',
        assessmentType: type,
        minimumAge: type === 'student' ? 15 : 18
      }, 400);
    }

    const expectedAnswerCount = EXPECTED_ANSWER_COUNTS[type];
    const receivedAnswerCount = Object.keys(answers).length;
    if (receivedAnswerCount !== expectedAnswerCount) {
      return json({
        error: 'incomplete_answers',
        assessmentType: type,
        expected: expectedAnswerCount,
        received: receivedAnswerCount
      }, 400);
    }

    const reviewToken = randomUUID();
    const sql = getSql();
    await ensureSchema(sql);
    const rows = await sql`
      INSERT INTO siga_results (profile, answers, results, review_token)
      VALUES (
        ${JSON.stringify({ ...profile, assessmentType: type })}::jsonb,
        ${JSON.stringify(answers)}::jsonb,
        ${JSON.stringify(results)}::jsonb,
        ${reviewToken}
      )
      RETURNING request_no, completed_at
    `;
    const row = rows[0];
    const id = requestId(row.request_no);
    await notifyAdminsOfCompletion(sql, {
      id,
      name: String(profile.name || 'مستفيد'),
      category: type === 'student' ? 'طالب' : 'موظف/قيادي'
    });
    return json({
      id,
      completedAt: row.completed_at,
      status: 'مكتمل',
      reviewToken
    }, 201);
  } catch (error) {
    console.error('SIGA POST error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function GET(request) {
  try {
    if (!normalizePin(process.env.SIGA_ADMIN_PIN)) {
      return json({ error: 'admin_not_configured' }, 503);
    }
    if (!adminAuthorized(request)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const sql = getSql();
    await ensureSchema(sql);
    const rows = await sql`
      SELECT request_no, profile, answers, results, status, completed_at
      FROM siga_results
      ORDER BY request_no DESC
    `;
    return json({
      records: rows.map(row => ({
        id: requestId(row.request_no),
        profile: row.profile,
        answers: row.answers,
        results: row.results,
        status: row.status,
        completedAt: row.completed_at
      }))
    });
  } catch (error) {
    console.error('SIGA GET error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!normalizePin(process.env.SIGA_ADMIN_PIN)) {
      return json({ error: 'admin_not_configured' }, 503);
    }
    if (!adminAuthorized(request)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const id = new URL(request.url).searchParams.get('id') || '';
    const match = id.match(/^SIGA-(\d+)$/);
    if (!match) return json({ error: 'invalid_request_id' }, 400);

    const sql = getSql();
    await ensureSchema(sql);
    const deleted = await sql`
      DELETE FROM siga_results
      WHERE request_no = ${Number(match[1])}
      RETURNING request_no
    `;
    if (!deleted.length) return json({ error: 'not_found' }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error('SIGA DELETE error', error);
    return json({ error: 'server_error' }, 500);
  }
}

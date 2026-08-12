import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';

const EXPECTED_ANSWER_COUNTS = Object.freeze({
  student: 125,
  employee: 180
});

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

export async function POST(request) {
  try {
    const { profile = {}, answers = {}, results = {} } = await request.json();

    if (!profile.name || !profile.mobile || !profile.email) {
      return json({ error: 'missing_profile' }, 400);
    }

    const type = assessmentType(profile);
    if (!type) {
      return json({ error: 'invalid_assessment_type' }, 400);
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

    const sql = getSql();
    await ensureSchema(sql);
    const rows = await sql`
      INSERT INTO siga_results (profile, answers, results)
      VALUES (
        ${JSON.stringify({ ...profile, assessmentType: type })}::jsonb,
        ${JSON.stringify(answers)}::jsonb,
        ${JSON.stringify(results)}::jsonb
      )
      RETURNING request_no, completed_at
    `;
    const row = rows[0];
    return json({
      id: requestId(row.request_no),
      completedAt: row.completed_at,
      status: 'مكتمل'
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

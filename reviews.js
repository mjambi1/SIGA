import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';

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
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      review_token TEXT
    )
  `;
  await sql`
    ALTER TABLE siga_results
    ADD COLUMN IF NOT EXISTS review_token TEXT
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS siga_reviews (
      review_id BIGSERIAL PRIMARY KEY,
      request_no BIGINT NOT NULL UNIQUE REFERENCES siga_results(request_no) ON DELETE CASCADE,
      reviewer_name TEXT NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ
    )
  `;
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function normalizePin(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFKC')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function safeEqual(expected, supplied) {
  const expectedBytes = Buffer.from(String(expected ?? ''));
  const suppliedBytes = Buffer.from(String(supplied ?? ''));
  return expectedBytes.length > 0 &&
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes);
}

function adminAuthorized(request) {
  return safeEqual(
    normalizePin(process.env.SIGA_ADMIN_PIN),
    normalizePin(request.headers.get('x-admin-pin'))
  );
}

function requestNumber(value) {
  const match = String(value ?? '').trim().match(/^SIGA-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function mapReview(row, includeRequest = false) {
  const review = {
    id: Number(row.review_id),
    name: row.reviewer_name,
    rating: Number(row.rating),
    comment: row.comment,
    status: row.status,
    createdAt: row.created_at
  };
  if (includeRequest) review.requestId = `SIGA-${String(row.request_no).padStart(6, '0')}`;
  return review;
}

export async function GET(request) {
  try {
    const sql = getSql();
    await ensureSchema(sql);
    const adminView = new URL(request.url).searchParams.get('admin') === '1';

    if (adminView) {
      if (!normalizePin(process.env.SIGA_ADMIN_PIN)) return json({ error: 'admin_not_configured' }, 503);
      if (!adminAuthorized(request)) return json({ error: 'unauthorized' }, 401);
      const rows = await sql`
        SELECT review_id, request_no, reviewer_name, rating, comment, status, created_at
        FROM siga_reviews
        ORDER BY review_id DESC
      `;
      return json({ reviews: rows.map(row => mapReview(row, true)) });
    }

    const rows = await sql`
      SELECT review_id, reviewer_name, rating, comment, status, created_at
      FROM siga_reviews
      WHERE status = 'approved'
      ORDER BY approved_at DESC NULLS LAST, review_id DESC
      LIMIT 50
    `;
    return json({ reviews: rows.map(row => mapReview(row)) });
  } catch (error) {
    console.error('SIGA reviews GET error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function POST(request) {
  try {
    const { requestId = '', reviewToken = '', rating, comment = '' } = await request.json();
    const number = requestNumber(requestId);
    const numericRating = Number(rating);
    const cleanComment = String(comment).trim();
    if (!number || !Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return json({ error: 'invalid_review' }, 400);
    }
    if (cleanComment.length < 3 || cleanComment.length > 800) {
      return json({ error: 'invalid_comment' }, 400);
    }

    const sql = getSql();
    await ensureSchema(sql);
    const completed = await sql`
      SELECT request_no, profile, review_token
      FROM siga_results
      WHERE request_no = ${number} AND status = 'مكتمل'
      LIMIT 1
    `;
    const record = completed[0];
    if (!record || !safeEqual(record.review_token, reviewToken)) {
      return json({ error: 'not_eligible' }, 403);
    }

    const reviewerName = String(record.profile?.name || 'مستفيد').trim().slice(0, 120);
    const inserted = await sql`
      INSERT INTO siga_reviews (request_no, reviewer_name, rating, comment)
      VALUES (${number}, ${reviewerName}, ${numericRating}, ${cleanComment})
      ON CONFLICT (request_no) DO NOTHING
      RETURNING review_id
    `;
    if (!inserted.length) return json({ error: 'already_submitted' }, 409);
    return json({ ok: true, status: 'pending' }, 201);
  } catch (error) {
    console.error('SIGA reviews POST error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function PATCH(request) {
  try {
    if (!normalizePin(process.env.SIGA_ADMIN_PIN)) return json({ error: 'admin_not_configured' }, 503);
    if (!adminAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    const { id, status } = await request.json();
    const reviewId = Number(id);
    if (!Number.isInteger(reviewId) || !['approved', 'hidden'].includes(status)) {
      return json({ error: 'invalid_update' }, 400);
    }

    const sql = getSql();
    await ensureSchema(sql);
    const updated = await sql`
      UPDATE siga_reviews
      SET status = ${status},
          approved_at = CASE WHEN ${status} = 'approved' THEN NOW() ELSE NULL END
      WHERE review_id = ${reviewId}
      RETURNING review_id
    `;
    if (!updated.length) return json({ error: 'not_found' }, 404);
    return json({ ok: true, status });
  } catch (error) {
    console.error('SIGA reviews PATCH error', error);
    return json({ error: 'server_error' }, 500);
  }
}

export async function DELETE(request) {
  try {
    if (!normalizePin(process.env.SIGA_ADMIN_PIN)) return json({ error: 'admin_not_configured' }, 503);
    if (!adminAuthorized(request)) return json({ error: 'unauthorized' }, 401);
    const reviewId = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isInteger(reviewId)) return json({ error: 'invalid_review_id' }, 400);

    const sql = getSql();
    await ensureSchema(sql);
    const deleted = await sql`
      DELETE FROM siga_reviews
      WHERE review_id = ${reviewId}
      RETURNING review_id
    `;
    if (!deleted.length) return json({ error: 'not_found' }, 404);
    return json({ ok: true });
  } catch (error) {
    console.error('SIGA reviews DELETE error', error);
    return json({ error: 'server_error' }, 500);
  }
}

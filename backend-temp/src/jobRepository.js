import { query } from "./db/connection.js";

function toNumber(value) {
  return Number(value || 0);
}

export function publicPersistentJob(row) {
  if (!row) return null;

  return {
    jobId: row.id,
    status: row.status,
    total: toNumber(row.total_count),
    processed: toNumber(row.processed_count),
    success: toNumber(row.success_count),
    failed: toNumber(row.failed_count),
    estimatedSeconds: Math.max(toNumber(row.total_count) * 18, 30),
    reportUrl: row.report_filename ? `/report/${encodeURIComponent(row.report_filename)}` : null,
    error: row.error_message,
    errorDetails: process.env.NODE_ENV === "production" ? null : row.error_details,
    logs: [],
    reportFilename: row.report_filename,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

export async function createPersistentJob({ userId, csvPath, total = 0, status = "processing" }) {
  const result = await query(
    `
      INSERT INTO jobs (user_id, csv_path, status, total_count, processed_count)
      VALUES ($1, $2, $3, $4, 0)
      RETURNING *
    `,
    [userId, csvPath, status, total]
  );

  return result.rows[0];
}

export async function findJobById(jobId) {
  const result = await query(
    `
      SELECT *
      FROM jobs
      WHERE id = $1
      LIMIT 1
    `,
    [jobId]
  );

  return result.rows[0] || null;
}

export async function findUserJobById({ userId, jobId }) {
  const result = await query(
    `
      SELECT *
      FROM jobs
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [jobId, userId]
  );

  return result.rows[0] || null;
}

export async function findUserJobByReportFilename({ userId, reportFilename }) {
  const result = await query(
    `
      SELECT *
      FROM jobs
      WHERE user_id = $1
        AND report_filename = $2
      LIMIT 1
    `,
    [userId, reportFilename]
  );

  return result.rows[0] || null;
}

export async function listUserJobs({ userId, limit = 50 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const result = await query(
    `
      SELECT *
      FROM jobs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, safeLimit]
  );

  return result.rows;
}

export async function updatePersistentJobProgress(jobId, patch = {}) {
  const result = await query(
    `
      UPDATE jobs
      SET total_count = COALESCE($2, total_count),
          processed_count = COALESCE($3, processed_count),
          success_count = COALESCE($4, success_count),
          failed_count = COALESCE($5, failed_count),
          error_message = COALESCE($6, error_message),
          error_details = COALESCE($7::jsonb, error_details)
      WHERE id = $1
      RETURNING *
    `,
    [
      jobId,
      patch.total ?? null,
      patch.processed ?? null,
      patch.success ?? null,
      patch.failed ?? null,
      patch.error ?? null,
      patch.errorDetails ? JSON.stringify(patch.errorDetails) : null
    ]
  );

  return result.rows[0] || null;
}

async function markTerminalJob(jobId, status, patch = {}) {
  const result = await query(
    `
      UPDATE jobs
      SET status = $2,
          completed_at = COALESCE(completed_at, now()),
          processed_count = COALESCE($3, processed_count),
          success_count = COALESCE($4, success_count),
          failed_count = COALESCE($5, failed_count),
          report_filename = COALESCE($6, report_filename),
          error_message = COALESCE($7, error_message),
          error_details = COALESCE($8::jsonb, error_details)
      WHERE id = $1
      RETURNING *
    `,
    [
      jobId,
      status,
      patch.processed ?? null,
      patch.success ?? null,
      patch.failed ?? null,
      patch.reportFilename ?? null,
      patch.error ?? null,
      patch.errorDetails ? JSON.stringify(patch.errorDetails) : null
    ]
  );

  return result.rows[0] || null;
}

export async function markPersistentJobDone(jobId, patch = {}) {
  return markTerminalJob(jobId, "done", patch);
}

export async function markPersistentJobFailed(jobId, patch = {}) {
  return markTerminalJob(jobId, "failed", patch);
}

export async function markPersistentJobCancelled(jobId, patch = {}) {
  return markTerminalJob(jobId, "cancelled", patch);
}
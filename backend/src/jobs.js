export const jobs = new Map();

export function createJob({ id = crypto.randomUUID(), userId = null, csvPath = null, total }) {
  const now = new Date().toISOString();

  const job = {
    id,
    userId,
    csvPath,
    status: "processing",
    total,
    processed: 0,
    success: 0,
    failed: 0,
    estimatedSeconds: Math.max(total * 18, 30),
    report: null,
    error: null,
    errorDetails: null,
    logs: [],
    createdAt: now,
    updatedAt: now
  };

  jobs.set(id, job);
  return job;
}

export function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

export function publicJob(job) {
  return {
    jobId: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    success: job.success,
    failed: job.failed,
    estimatedSeconds: job.estimatedSeconds,
    reportUrl: job.report ? `/report/${encodeURIComponent(job.report)}` : null,
    error: job.error,
    errorDetails: process.env.NODE_ENV === "production" ? null : job.errorDetails,
    logs: job.logs.slice(-20)
  };
}

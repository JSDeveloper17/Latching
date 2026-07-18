import express from "express";
import cors from "cors";
import multer from "multer";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "./config.js";
import { cancelAutomation, runAutomation } from "./automationRunner.js";
import { createJob, jobs, publicJob } from "./jobs.js";
import { ensureFolders } from "./reportService.js";
import { validateCsv } from "./csvValidation.js";
import { ApiError, asyncHandler, normalizeError } from "./errors.js";
import { logger } from "./logger.js";
import { authRouter } from "./auth/routes.js";
import { authenticateUser } from "./auth/middleware.js";
import { flipkartSettingsRouter } from "./settings/flipkartRoutes.js";
import { findVerifiedFlipkartAccountSecretByUserId } from "./settings/flipkartAccounts.js";
import { decrypt } from "./security/encryption.js";
import { jobRouter } from "./jobRoutes.js";
import { writeAuditLog } from "./auditLogger.js";
import {
  createPersistentJob,
  findUserJobById,
  findUserJobByReportFilename,
  publicPersistentJob
} from "./jobRepository.js";

await ensureFolders([config.uploadsDir, config.reportsDir]);

const app = express();

function errorLogMetadata(error, normalized, req) {
  const metadata = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    status: normalized.statusCode,
    message: normalized.message
  };

  if (config.nodeEnv !== "production") {
    metadata.details = normalized.details;
    metadata.stack = error.stack;
  }

  return metadata;
}

app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  logger.info("API request started", {
    requestId,
    method: req.method,
    path: req.originalUrl,
    origin: req.headers.origin || null
  });

  res.on("finish", () => {
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "success";
    logger[level]("API request finished", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
});

app.use(
  cors({
    origin(origin, cb) {
      const allowedOrigins = new Set([
        config.frontendUrl,
        "http://localhost:5173",
        "http://127.0.0.1:5173"
      ]);

      if (!origin || allowedOrigins.has(origin)) {
        return cb(null, true);
      }

      return cb(new Error("Origin is not allowed by CORS."));
    },
    credentials: true,
    exposedHeaders: ["X-Request-Id"]
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/auth", authRouter);
app.use("/settings/flipkart", authenticateUser, flipkartSettingsRouter);
app.use("/jobs", authenticateUser, jobRouter);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-z0-9_-]/gi, "_")
      .slice(0, 60);
    const safeExt = path.extname(file.originalname).toLowerCase() === ".xlsx" ? ".xlsx" : ".csv";
    cb(null, `${Date.now()}_${safeBase || "upload"}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const isAllowedSpreadsheet = extension === ".csv" || extension === ".xlsx";

    cb(isAllowedSpreadsheet ? null : new Error("Only CSV or XLSX files are allowed."), isAllowedSpreadsheet);
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "flipkart-latching-api" });
});

app.get("/sample", authenticateUser, (_req, res) => {
  res.download(config.sampleCsvPath, "flipkart-latching-sample.csv");
});

async function handleUploadedCsv(req, res) {
  if (!req.file) {
    throw new ApiError(400, "CSV or XLSX file is required.");
  }

  logger.info("Spreadsheet upload received", {
    requestId: req.requestId,
    originalName: req.file.originalname,
    savedAs: req.file.filename,
    size: req.file.size
  });

  let validation;
  try {
    validation = await validateCsv(req.file.path);
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    throw error;
  }

  const flipkartAccount = await findVerifiedFlipkartAccountSecretByUserId(req.user.id);
  if (!flipkartAccount) {
    await fs.unlink(req.file.path).catch(() => {});
    throw new ApiError(422, "Connect and verify your Flipkart seller account before starting a latching run.", {
      settingsPath: "/settings/flipkart"
    });
  }

  let sellerPassword;
  try {
    sellerPassword = decrypt(flipkartAccount.seller_password_encrypted);
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => {});
    throw error;
  }

  const persistentJob = await createPersistentJob({
    userId: req.user.id,
    csvPath: req.file.path,
    total: validation.total,
    status: "processing"
  });

  const job = createJob({
    id: persistentJob.id,
    userId: req.user.id,
    csvPath: req.file.path,
    total: validation.total
  });
  logger.success("Spreadsheet accepted and job created", {
    requestId: req.requestId,
    jobId: job.id,
    userId: req.user.id,
    totalRows: validation.total,
    file: req.file.filename,
    sellerEmail: flipkartAccount.seller_email
  });

  await writeAuditLog({
    userId: req.user.id,
    action: "job_created",
    entityType: "job",
    entityId: job.id,
    requestId: req.requestId,
    metadata: {
      totalRows: validation.total,
      uploadFilename: req.file.filename,
      sellerEmail: flipkartAccount.seller_email
    }
  });

  runAutomation(job.id, req.file.path, {
    sellerEmail: flipkartAccount.seller_email,
    sellerPassword
  });

  return res.status(202).json(publicJob(job));
}

app.post("/upload", authenticateUser, upload.single("file"), asyncHandler(handleUploadedCsv));

// Compatibility route for the previous Flask app.py form field.
app.post("/run", authenticateUser, upload.single("csv_file"), asyncHandler(handleUploadedCsv));

async function downloadReport(req, res) {
  const filename = path.basename(req.params.filename);
  const owningJob = await findUserJobByReportFilename({
    userId: req.user.id,
    reportFilename: filename
  });

  if (!owningJob) {
    throw new ApiError(404, "Report not found.", { filename });
  }
  const reportPath = path.join(config.reportsDir, filename);
  const exists = await fs
    .access(reportPath)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    throw new ApiError(404, "Report not found.", { filename });
  }

  logger.info("Report download started", {
    requestId: req.requestId,
    filename,
    jobId: owningJob.id
  });

  await writeAuditLog({
    userId: req.user.id,
    action: "report_downloaded",
    entityType: "job",
    entityId: owningJob.id,
    requestId: req.requestId,
    metadata: { reportFilename: filename }
  });

  return res.download(reportPath, filename, (error) => {
    if (error) {
      logger.error("Report download failed", {
        requestId: req.requestId,
        filename,
        message: error.message
      });
    }
  });
}

app.get("/reports/:filename", authenticateUser, asyncHandler(downloadReport));

app.get("/reports/:filename(*)", authenticateUser, asyncHandler(downloadReport));

app.get("/status/:jobId", authenticateUser, asyncHandler(async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (job) {
    if (job.userId && job.userId !== req.user.id) {
      throw new ApiError(403, "You do not have access to this job.");
    }

    return res.json(publicJob(job));
  }

  const persistentJob = await findUserJobById({
    userId: req.user.id,
    jobId: req.params.jobId
  });

  if (!persistentJob) {
    throw new ApiError(404, "Job not found.", { jobId: req.params.jobId });
  }

  return res.json(publicPersistentJob(persistentJob));
}));

app.post("/cancel/:jobId", authenticateUser, asyncHandler(async (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    throw new ApiError(404, "Job not found.", { jobId: req.params.jobId });
  }

  if (job.userId && job.userId !== req.user.id) {
    throw new ApiError(403, "You do not have access to this job.");
  }

  if (!["processing", "queued"].includes(job.status)) {
    return res.json({
      ...publicJob(job),
      cancelled: false,
      message: `Job is already ${job.status}.`
    });
  }

  const result = cancelAutomation(job.id);
  const updatedJob = jobs.get(job.id);

  logger.warn("Automation cancellation requested", {
    requestId: req.requestId,
    jobId: job.id,
    cancelled: result.cancelled,
    reason: result.reason || null
  });

  await writeAuditLog({
    userId: req.user.id,
    action: result.cancelled ? "job_cancelled" : "job_cancel_requested",
    entityType: "job",
    entityId: job.id,
    requestId: req.requestId,
    metadata: {
      cancelled: result.cancelled,
      reason: result.reason || null
    }
  });

  return res.json({
    ...publicJob(updatedJob),
    cancelled: result.cancelled,
    message: result.cancelled ? "Automation stopped." : result.reason
  });
}));

app.get("/report/:filename", authenticateUser, asyncHandler(downloadReport));

app.use((req, _res, next) => {
  next(new ApiError(404, "API route not found.", { method: req.method, path: req.originalUrl }));
});

app.use((error, req, res, _next) => {
  const normalized = normalizeError(error);
  const isProduction = process.env.NODE_ENV === "production";

  logger.error("API error handled", errorLogMetadata(error, normalized, req));

  res.status(normalized.statusCode).json({
    ok: false,
    message: normalized.message,
    requestId: req.requestId,
    details: isProduction ? undefined : normalized.details
  });
});

app.listen(config.port, () => {
  logger.success(`Flipkart latching API running on http://localhost:${config.port}`, {
    frontendUrl: config.frontendUrl,
    pythonBin: config.pythonBin,
    uploadsDir: config.uploadsDir,
    reportsDir: config.reportsDir
  });
});

process.on("unhandledRejection", (reason) => {
  const isProduction = config.nodeEnv === "production";
  logger.error("Unhandled promise rejection", {
    reason: reason?.message || String(reason),
    stack: isProduction ? undefined : reason?.stack
  });
});

process.on("uncaughtException", (error) => {
  const isProduction = config.nodeEnv === "production";
  logger.error("Uncaught exception", {
    message: error.message,
    stack: isProduction ? undefined : error.stack
  });
});




import { exec, execFile } from "node:child_process";
import path from "node:path";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { latestReportAfter, summarizeReport } from "./reportService.js";
import { updateJob } from "./jobs.js";
import { logger } from "./logger.js";
import { writeAuditLog } from "./auditLogger.js";
import {
  markPersistentJobCancelled,
  markPersistentJobDone,
  markPersistentJobFailed,
  updatePersistentJobProgress
} from "./jobRepository.js";

const runningProcesses = new Map();

function persistProgress(jobId, patch) {
  if (!Object.keys(patch).length) return;

  updatePersistentJobProgress(jobId, patch).catch((error) => {
    logger.error("Unable to persist job progress", {
      jobId,
      message: error.message
    });
  });
}

function appendLog(jobId, message) {
  const clean = message.trim();
  if (!clean) return;

  const job = updateJob(jobId, {});
  if (!job) return;

  logger.info(`Automation log for job ${jobId}`, { message: clean });
  job.logs.push(clean);
  job.logs = job.logs.slice(-50);

  const progressPatch = {};
  const processingMatches = clean.match(/Processing FSN=/gi);
  if (processingMatches) {
    const updatedJob = updateJob(jobId, {
      processed: Math.min(job.total, job.processed + processingMatches.length)
    });
    progressPatch.processed = updatedJob?.processed;
  }

  if (/Error processing FSN/i.test(clean)) {
    const updatedJob = updateJob(jobId, { failed: job.failed + 1 });
    progressPatch.failed = updatedJob?.failed;
  }

  persistProgress(jobId, progressPatch);
}

function failureMessageFromLogs(job, fallback) {
  const latestMeaningfulLog = job?.logs
    ?.slice()
    .reverse()
    .find((line) => line && !line.startsWith("Traceback"));

  if (latestMeaningfulLog?.includes("Flipkart seller credentials")) {
    return "Flipkart credentials were not provided to the automation process. Reconnect and verify your Flipkart seller account, then start a new latching run.";
  }

  return latestMeaningfulLog || fallback;
}

async function auditTerminalJob(row, action, metadata = {}) {
  if (!row) return;

  await writeAuditLog({
    userId: row.user_id,
    action,
    entityType: "job",
    entityId: row.id,
    metadata
  });
}

async function markFailed(jobId, patch = {}) {
  try {
    const row = await markPersistentJobFailed(jobId, patch);
    await auditTerminalJob(row, "job_failed", {
      error: patch.error || null,
      processed: patch.processed ?? null,
      failed: patch.failed ?? null
    });
    return row;
  } catch (error) {
    logger.error("Unable to mark persistent job failed", {
      jobId,
      message: error.message
    });
    return null;
  }
}

async function markDone(jobId, patch = {}) {
  try {
    const row = await markPersistentJobDone(jobId, patch);
    await auditTerminalJob(row, "job_completed", {
      reportFilename: patch.reportFilename || null,
      processed: patch.processed ?? null,
      success: patch.success ?? null,
      failed: patch.failed ?? null
    });
    return row;
  } catch (error) {
    logger.error("Unable to mark persistent job done", {
      jobId,
      message: error.message
    });
    return null;
  }
}

export function runAutomation(jobId, filePath, { sellerEmail, sellerPassword } = {}) {
  if (!sellerEmail || !sellerPassword) {
    throw new ApiError(
      422,
      "A verified Flipkart seller account is required before starting a latching run."
    );
  }

  const startedAtMs = Date.now();
  const args = [config.scriptPath, "--csv", filePath];

  logger.info("Starting Python automation", {
    jobId,
    pythonBin: config.pythonBin,
    script: config.scriptPath,
    cwd: config.rootDir,
    upload: filePath,
    reportsDir: config.reportsDir,
    sellerEmail
  });

  const child = execFile(
    config.pythonBin,
    args,
    {
      cwd: config.rootDir,
      env: {
        ...process.env,
        REPORT_DIR: config.reportsDir,
        LATCHING_SELLER_EMAIL: sellerEmail,
        LATCHING_SELLER_PASSWORD: sellerPassword
      },
      maxBuffer: 1024 * 1024 * 20,
      windowsHide: false
    },
    async (error) => {
      runningProcesses.delete(jobId);
      const currentJob = updateJob(jobId, {});

      if (currentJob?.status === "cancelled") {
        logger.warn("Python automation exited after cancellation", { jobId });
        return;
      }

      if (error) {
        const job = updateJob(jobId, {});
        const userMessage = failureMessageFromLogs(
          job,
          "Automation failed. Check Python, Selenium, ChromeDriver, and Flipkart credentials."
        );
        const errorDetails = {
          originalMessage: error.message,
          code: error.code,
          signal: error.signal,
          pythonBin: config.pythonBin,
          script: config.scriptPath
        };

        await markFailed(jobId, {
          processed: job?.processed,
          failed: job?.failed,
          error: userMessage,
          errorDetails
        });

        logger.error("Python automation failed", {
          jobId,
          message: error.message,
          code: error.code,
          signal: error.signal
        });

        updateJob(jobId, {
          status: "failed",
          error: userMessage,
          errorDetails
        });
        return;
      }

      try {
        const report = await latestReportAfter(config.reportsDir, startedAtMs);
        if (!report) {
          const message = "Automation finished but no report CSV was generated.";
          await markFailed(jobId, {
            error: message,
            errorDetails: { reportsDir: config.reportsDir }
          });
          logger.error("Automation finished without report", { jobId, reportsDir: config.reportsDir });
          updateJob(jobId, {
            status: "failed",
            error: message,
            errorDetails: { reportsDir: config.reportsDir }
          });
          return;
        }

        const summary = await summarizeReport(path.join(config.reportsDir, report));
        const job = updateJob(jobId, {});
        const processed = job?.total || summary.success + summary.failed;

        logger.success("Automation completed", {
          jobId,
          report,
          success: summary.success,
          failed: summary.failed
        });

        updateJob(jobId, {
          status: "done",
          processed,
          success: summary.success,
          failed: summary.failed,
          report
        });
        await markDone(jobId, {
          processed,
          success: summary.success,
          failed: summary.failed,
          reportFilename: report
        });
      } catch (reportError) {
        const errorDetails = {
          originalMessage: reportError.message,
          stack: reportError.stack
        };
        await markFailed(jobId, {
          error: reportError.message || "Unable to read generated report.",
          errorDetails
        });
        logger.error("Unable to read generated report", {
          jobId,
          message: reportError.message,
          stack: reportError.stack
        });

        updateJob(jobId, {
          status: "failed",
          error: reportError.message || "Unable to read generated report.",
          errorDetails
        });
      }
    }
  );

  runningProcesses.set(jobId, child);

  child.on("error", (error) => {
    runningProcesses.delete(jobId);
    const errorDetails = {
      originalMessage: error.message,
      code: error.code,
      pythonBin: config.pythonBin,
      script: config.scriptPath
    };

    markFailed(jobId, {
      error: "Failed to start Python process. Check PYTHON_BIN and Python installation.",
      errorDetails
    });

    logger.error("Failed to start Python process", {
      jobId,
      message: error.message,
      code: error.code
    });

    updateJob(jobId, {
      status: "failed",
      error: "Failed to start Python process. Check PYTHON_BIN and Python installation.",
      errorDetails
    });
  });

  child.stdout?.on("data", (chunk) => appendLog(jobId, chunk.toString()));
  child.stderr?.on("data", (chunk) => appendLog(jobId, chunk.toString()));
}

export function cancelAutomation(jobId) {
  const child = runningProcesses.get(jobId);

  if (!child) {
    return { cancelled: false, reason: "No running automation process was found for this job." };
  }

  const pid = child.pid;
  updateJob(jobId, {
    status: "cancelled",
    error: "Automation was stopped by the user.",
    errorDetails: null
  });
  markPersistentJobCancelled(jobId, {
    error: "Automation was stopped by the user."
  }).catch((error) => {
    logger.error("Unable to mark persistent job cancelled", {
      jobId,
      message: error.message
    });
  });

  logger.warn("Cancelling Python automation", { jobId, pid });

  if (process.platform === "win32" && pid) {
    exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, (error) => {
      runningProcesses.delete(jobId);
      if (error) {
        logger.error("Failed to taskkill Python automation", {
          jobId,
          pid,
          message: error.message
        });
      } else {
        logger.success("Python automation process tree stopped", { jobId, pid });
      }
    });
  } else {
    child.kill("SIGTERM");
    runningProcesses.delete(jobId);
  }

  return { cancelled: true };
}
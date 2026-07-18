import { execFile } from "node:child_process";
import { config } from "./config.js";
import { logger } from "./logger.js";

function parseVerifierOutput(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.success === "boolean") return parsed;
    } catch {
      // Keep scanning; Selenium and Python may emit non-JSON diagnostic lines.
    }
  }

  return null;
}

export function verifyFlipkartCredentials({ sellerEmail, sellerPassword }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();

    logger.info("Starting Flipkart account verification", {
      sellerEmail,
      verifier: config.verifierScriptPath,
      timeoutMs: config.verificationTimeoutMs
    });

    const child = execFile(
      config.pythonBin,
      [config.verifierScriptPath],
      {
        cwd: config.rootDir,
        env: {
          ...process.env,
          FK_VERIFY_EMAIL: sellerEmail,
          FK_VERIFY_PASSWORD: sellerPassword,
          VERIFY_HEADLESS: process.env.VERIFY_HEADLESS || (config.nodeEnv === "production" ? "true" : "false")
        },
        timeout: config.verificationTimeoutMs,
        maxBuffer: 1024 * 1024 * 5,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const parsed = parseVerifierOutput(stdout);

        if (parsed?.success) {
          logger.success("Flipkart account verification succeeded", {
            sellerEmail,
            durationMs
          });
          resolve({
            success: true,
            message: parsed.message || "Flipkart account verified.",
            details: {
              durationMs
            }
          });
          return;
        }

        const message =
          parsed?.message ||
          (error?.killed ? "Flipkart verification timed out." : null) ||
          stderr
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(-1)[0] ||
          error?.message ||
          "Flipkart verification failed.";

        logger.warn("Flipkart account verification failed", {
          sellerEmail,
          durationMs,
          exitCode: error?.code ?? null,
          signal: error?.signal ?? null,
          message
        });

        resolve({
          success: false,
          message,
          details: {
            durationMs,
            exitCode: error?.code ?? null,
            signal: error?.signal ?? null
          }
        });
      }
    );

    child.on("error", (error) => {
      logger.error("Unable to start Flipkart verifier", {
        sellerEmail,
        message: error.message,
        code: error.code
      });
    });
  });
}

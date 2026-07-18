import express from "express";
import { verifyFlipkartCredentials } from "../automationVerifier.js";
import { ApiError, asyncHandler } from "../errors.js";
import { logger } from "../logger.js";
import { writeAuditLog } from "../auditLogger.js";
import { assertEncryptionConfigured, encrypt } from "../security/encryption.js";
import {
  findFlipkartAccountByUserId,
  publicFlipkartAccount,
  saveVerifiedFlipkartAccount
} from "./flipkartAccounts.js";

export const flipkartSettingsRouter = express.Router();

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(422, `${field} is required.`);
  }

  return value.trim();
}

function requireEmail(value) {
  const email = requireString(value, "Flipkart seller email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, "Enter a valid Flipkart seller email address.");
  }

  return email;
}

flipkartSettingsRouter.get(
  "/account",
  asyncHandler(async (req, res) => {
    const account = await findFlipkartAccountByUserId(req.user.id);
    res.json({ ok: true, account: publicFlipkartAccount(account) });
  })
);

flipkartSettingsRouter.post(
  "/connect",
  asyncHandler(async (req, res) => {
    const sellerEmail = requireEmail(req.body?.sellerEmail);
    const sellerPassword = requireString(req.body?.sellerPassword, "Flipkart seller password");

    assertEncryptionConfigured();

    const verification = await verifyFlipkartCredentials({ sellerEmail, sellerPassword });

    if (!verification.success) {
      await writeAuditLog({
        userId: req.user.id,
        action: "flipkart_account_verification_failed",
        entityType: "flipkart_account",
        requestId: req.requestId,
        metadata: {
          sellerEmail,
          durationMs: verification.details?.durationMs || null,
          message: verification.message || null
        }
      });

      throw new ApiError(422, verification.message || "Flipkart verification failed.", {
        verification: {
          success: false,
          durationMs: verification.details?.durationMs
        }
      });
    }

    const encryptedPassword = encrypt(sellerPassword);
    const account = await saveVerifiedFlipkartAccount({
      userId: req.user.id,
      sellerEmail,
      encryptedPassword
    });

    logger.success("Flipkart account connected", {
      requestId: req.requestId,
      userId: req.user.id,
      sellerEmail
    });

    await writeAuditLog({
      userId: req.user.id,
      action: "flipkart_account_connected",
      entityType: "flipkart_account",
      entityId: account.id,
      requestId: req.requestId,
      metadata: {
        sellerEmail,
        durationMs: verification.details?.durationMs || null
      }
    });

    res.json({
      ok: true,
      account: publicFlipkartAccount(account),
      verification: {
        success: true,
        message: verification.message
      }
    });
  })
);

import crypto from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../errors.js";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function decodeKey(rawKey) {
  const value = String(rawKey || "").trim();
  if (!value) return null;

  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }

  const base64Candidate = Buffer.from(value, "base64");
  if (base64Candidate.length === 32 && base64Candidate.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")) {
    return base64Candidate;
  }

  const utf8Candidate = Buffer.from(value, "utf8");
  if (utf8Candidate.length === 32) {
    return utf8Candidate;
  }

  return null;
}

function encryptionKey() {
  const key = decodeKey(config.flipkartCredentialEncryptionKey);
  if (key) return key;

  throw new ApiError(
    500,
    "Flipkart credential encryption key is not configured. Set FLIPKART_CREDENTIAL_ENCRYPTION_KEY to a 32-byte base64 or hex key."
  );
}

export function assertEncryptionConfigured() {
  encryptionKey();
}

export function encrypt(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new ApiError(422, "A non-empty value is required for encryption.");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64")
  ].join(":");
}

export function decrypt(encryptedValue) {
  const parts = String(encryptedValue || "").split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new ApiError(500, "Encrypted value format is not supported.");
  }

  const [, ivBase64, tagBase64, ciphertextBase64] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, "base64")),
    decipher.final()
  ]).toString("utf8");
}

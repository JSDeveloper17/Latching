import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(backendDir, "..");

dotenv.config({ path: path.join(backendDir, ".env") });

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 5000),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  pythonBin: process.env.PYTHON_BIN || "python",
  databaseUrl: process.env.DATABASE_URL || "",
  databaseSsl: process.env.DATABASE_SSL !== "false",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
  authCookieName: process.env.COOKIE_NAME || "latching_access_token",
  flipkartCredentialEncryptionKey: process.env.FLIPKART_CREDENTIAL_ENCRYPTION_KEY || "",
  verificationTimeoutMs: Number(process.env.FLIPKART_VERIFICATION_TIMEOUT_MS || 120000),
  csvMaxRows: Number(process.env.CSV_MAX_ROWS || 100),
  rootDir,
  backendDir,
  uploadsDir: path.join(rootDir, "uploads"),
  reportsDir: path.join(rootDir, "reports"),
  scriptPath: path.join(rootDir, "final_cd.py"),
  verifierScriptPath: path.join(rootDir, "verify_flipkart_login.py"),
  sampleCsvPath: path.join(backendDir, "sample.csv")
};



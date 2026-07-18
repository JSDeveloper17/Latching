import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, hasDatabaseUrl, query } from "./connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "migrations");

const requiredTables = ["users", "flipkart_accounts", "jobs", "audit_logs"];
const requiredSnippets = [
  "CREATE EXTENSION IF NOT EXISTS pgcrypto",
  "CREATE EXTENSION IF NOT EXISTS citext",
  "CREATE TABLE IF NOT EXISTS users",
  "CREATE TABLE IF NOT EXISTS flipkart_accounts",
  "CREATE TABLE IF NOT EXISTS jobs",
  "users_email_unique",
  "flipkart_accounts_user_id_unique",
  "flipkart_accounts_user_id_fk",
  "jobs_user_id_fk",
  "jobs_user_id_created_at_idx",
  "CREATE TABLE IF NOT EXISTS audit_logs",
  "audit_logs_user_id_fk",
  "jobs_user_report_filename_idx"
];

async function readMigrationSql() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  const parts = await Promise.all(
    files.map(async (filename) => fs.readFile(path.join(migrationsDir, filename), "utf8"))
  );

  return parts.join("\n");
}

async function validateMigrationFiles() {
  const sql = await readMigrationSql();
  const missing = requiredSnippets.filter((snippet) => !sql.includes(snippet));

  if (missing.length > 0) {
    throw new Error(`Migration file validation failed. Missing: ${missing.join(", ")}`);
  }

  console.log("Migration file validation passed.");
}

async function validateLiveSchema() {
  const tableResult = await query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1)
      ORDER BY table_name
    `,
    [requiredTables]
  );

  const existingTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));

  if (missingTables.length > 0) {
    throw new Error(`Live schema validation failed. Missing tables: ${missingTables.join(", ")}`);
  }

  const constraintResult = await query(`
    SELECT conname
    FROM pg_constraint
    WHERE conname IN (
      'users_email_unique',
      'flipkart_accounts_user_id_unique',
      'flipkart_accounts_user_id_fk',
      'jobs_user_id_fk',
      'jobs_status_valid',
      'audit_logs_user_id_fk',
      'jobs_counts_non_negative'
    )
  `);

  const constraints = new Set(constraintResult.rows.map((row) => row.conname));
  const requiredConstraints = [
    "users_email_unique",
    "flipkart_accounts_user_id_unique",
    "flipkart_accounts_user_id_fk",
    "jobs_user_id_fk",
    "jobs_status_valid",
    "audit_logs_user_id_fk",
    "jobs_counts_non_negative"
  ];
  const missingConstraints = requiredConstraints.filter((constraint) => !constraints.has(constraint));

  if (missingConstraints.length > 0) {
    throw new Error(`Live schema validation failed. Missing constraints: ${missingConstraints.join(", ")}`);
  }

  console.log("Live database schema validation passed.");
}

async function run() {
  await validateMigrationFiles();

  if (!hasDatabaseUrl()) {
    console.warn("DATABASE_URL is not configured; skipped live database validation.");
    return;
  }

  await validateLiveSchema();
}

run()
  .then(async () => {
    await closePool();
  })
  .catch(async (error) => {
    console.error("Schema validation failed:", error.message);
    await closePool();
    process.exitCode = 1;
  });

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, hasDatabaseUrl, withClient } from "./connection.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "migrations");

async function listMigrations() {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
}

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id bigserial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum text NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedMigrations(client) {
  const result = await client.query("SELECT filename, checksum FROM schema_migrations ORDER BY filename");
  return new Map(result.rows.map((row) => [row.filename, row.checksum]));
}

async function run() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const migrations = await listMigrations();

  await withClient(async (client) => {
    await ensureMigrationTable(client);
    const applied = await appliedMigrations(client);

    for (const filename of migrations) {
      const fullPath = path.join(migrationsDir, filename);
      const sql = await fs.readFile(fullPath, "utf8");
      const currentChecksum = checksum(sql);
      const previousChecksum = applied.get(filename);

      if (previousChecksum) {
        if (previousChecksum !== currentChecksum) {
          throw new Error(`Migration checksum changed after execution: ${filename}`);
        }

        console.log(`Already applied: ${filename}`);
        continue;
      }

      console.log(`Applying: ${filename}`);
      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)",
          [filename, currentChecksum]
        );
        await client.query("COMMIT");
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  });
}

run()
  .then(async () => {
    console.log("Database migrations complete.");
    await closePool();
  })
  .catch(async (error) => {
    console.error("Database migration failed:", error.message);
    await closePool();
    process.exitCode = 1;
  });

import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

let pool;

export function hasDatabaseUrl() {
  return Boolean(config.databaseUrl);
}

export function getPool() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
    });
  }

  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function withClient(callback) {
  const client = await getPool().connect();

  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;

  await pool.end();
  pool = undefined;
}

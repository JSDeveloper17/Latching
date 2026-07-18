import { query } from "../db/connection.js";

export function publicUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createUser({ name, email, passwordHash }) {
  const result = await query(
    `
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, name, email, role, created_at, updated_at
    `,
    [name.trim(), email.trim().toLowerCase(), passwordHash]
  );

  return result.rows[0];
}

export async function findUserByEmailWithPassword(email) {
  const result = await query(
    `
      SELECT id, name, email, password_hash, role, created_at, updated_at
      FROM users
      WHERE email = $1
      LIMIT 1
    `,
    [email.trim().toLowerCase()]
  );

  return result.rows[0] || null;
}

export async function findUserById(id) {
  const result = await query(
    `
      SELECT id, name, email, role, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] || null;
}

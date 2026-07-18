import { query } from "../db/connection.js";

export function publicFlipkartAccount(row) {
  if (!row) {
    return {
      connected: false,
      sellerEmail: null,
      isVerified: false,
      lastVerifiedAt: null,
      updatedAt: null
    };
  }

  return {
    connected: true,
    sellerEmail: row.seller_email,
    isVerified: row.is_verified,
    lastVerifiedAt: row.last_verified_at,
    updatedAt: row.updated_at
  };
}

export async function findFlipkartAccountByUserId(userId) {
  const result = await query(
    `
      SELECT id, user_id, seller_email, is_verified, last_verified_at, created_at, updated_at
      FROM flipkart_accounts
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

export async function findVerifiedFlipkartAccountSecretByUserId(userId) {
  const result = await query(
    `
      SELECT
        id,
        user_id,
        seller_email,
        seller_password_encrypted,
        is_verified,
        last_verified_at,
        created_at,
        updated_at
      FROM flipkart_accounts
      WHERE user_id = $1
        AND is_verified = true
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

export async function saveVerifiedFlipkartAccount({ userId, sellerEmail, encryptedPassword }) {
  const result = await query(
    `
      INSERT INTO flipkart_accounts (
        user_id,
        seller_email,
        seller_password_encrypted,
        is_verified,
        last_verified_at
      )
      VALUES ($1, $2, $3, true, now())
      ON CONFLICT (user_id)
      DO UPDATE SET
        seller_email = EXCLUDED.seller_email,
        seller_password_encrypted = EXCLUDED.seller_password_encrypted,
        is_verified = true,
        last_verified_at = now()
      RETURNING id, user_id, seller_email, is_verified, last_verified_at, created_at, updated_at
    `,
    [userId, sellerEmail.trim().toLowerCase(), encryptedPassword]
  );

  return result.rows[0];
}

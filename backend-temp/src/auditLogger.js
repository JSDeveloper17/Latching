import { query } from "./db/connection.js";
import { logger } from "./logger.js";

export async function writeAuditLog({ userId = null, action, entityType, entityId = null, metadata = {}, requestId = null }) {
  try {
    await query(
      `
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, request_id)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [userId, action, entityType, entityId, JSON.stringify(metadata || {}), requestId]
    );
  } catch (error) {
    logger.error("Unable to write audit log", {
      userId,
      action,
      entityType,
      entityId,
      requestId,
      message: error.message
    });
  }
}
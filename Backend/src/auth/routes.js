import express from "express";
import { ApiError, asyncHandler } from "../errors.js";
import { logger } from "../logger.js";
import { clearAuthCookie, setAuthCookie, signAccessToken } from "./jwt.js";
import { authenticateUser } from "./middleware.js";
import { createUser, findUserByEmailWithPassword, publicUser } from "./users.js";
import { hashPassword, validatePassword, verifyPassword } from "./passwords.js";
import { writeAuditLog } from "../auditLogger.js";

export const authRouter = express.Router();

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(422, `${field} is required.`);
  }

  return value.trim();
}

function requireEmail(value) {
  const email = requireString(value, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(422, "Enter a valid email address.");
  }

  return email;
}

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const name = requireString(req.body?.name, "Name");
    const email = requireEmail(req.body?.email);
    const password = req.body?.password;
    validatePassword(password);

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await createUser({ name, email, passwordHash });
    } catch (error) {
      if (error.code === "23505") {
        throw new ApiError(409, "An account with this email already exists.");
      }

      throw error;
    }

    const safeUser = publicUser(user);
    setAuthCookie(res, signAccessToken(safeUser));

    logger.success("User signup completed", {
      requestId: req.requestId,
      userId: safeUser.id,
      email: safeUser.email
    });

    await writeAuditLog({
      userId: safeUser.id,
      action: "user_signup",
      entityType: "user",
      entityId: safeUser.id,
      requestId: req.requestId,
      metadata: { email: safeUser.email, role: safeUser.role }
    });

    res.status(201).json({ ok: true, user: safeUser });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const email = requireEmail(req.body?.email);
    const password = req.body?.password;
    const user = await findUserByEmailWithPassword(email);
    const passwordMatches = await verifyPassword(password, user?.password_hash);

    if (!user || !passwordMatches) {
      throw new ApiError(401, "Invalid email or password.");
    }

    const safeUser = publicUser(user);
    setAuthCookie(res, signAccessToken(safeUser));

    logger.success("User login completed", {
      requestId: req.requestId,
      userId: safeUser.id,
      email: safeUser.email
    });

    await writeAuditLog({
      userId: safeUser.id,
      action: "user_login",
      entityType: "user",
      entityId: safeUser.id,
      requestId: req.requestId,
      metadata: { email: safeUser.email, role: safeUser.role }
    });

    res.json({ ok: true, user: safeUser });
  })
);

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", authenticateUser, (req, res) => {
  res.json({ ok: true, user: req.user });
});

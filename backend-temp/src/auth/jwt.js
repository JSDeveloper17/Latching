import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { ApiError } from "../errors.js";

function jwtSecret() {
  if (config.jwtSecret) return config.jwtSecret;

  if (config.nodeEnv === "production") {
    throw new ApiError(500, "JWT_SECRET is not configured.");
  }

  return "dev-only-latching-jwt-secret-change-before-production";
}

function parseDurationMs(value) {
  const match = String(value || "").trim().match(/^(\d+)([smhd])?$/i);
  if (!match) return 60 * 60 * 1000;

  const amount = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role
    },
    jwtSecret(),
    {
      expiresIn: config.jwtExpiresIn,
      issuer: "latching-api",
      audience: "latching-web"
    }
  );
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, jwtSecret(), {
      issuer: "latching-api",
      audience: "latching-web"
    });
  } catch {
    throw new ApiError(401, "Authentication required.");
  }
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: config.nodeEnv === "production" ? "none" : "lax",
    maxAge: parseDurationMs(config.jwtExpiresIn),
    path: "/"
  };
}

export function setAuthCookie(res, token) {
  res.cookie(config.authCookieName, token, authCookieOptions());
}

export function clearAuthCookie(res) {
  res.clearCookie(config.authCookieName, {
    ...authCookieOptions(),
    maxAge: undefined
  });
}

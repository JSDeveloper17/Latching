import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { findUserById, publicUser } from "./users.js";
import { verifyAccessToken } from "./jwt.js";

function tokenFromRequest(req) {
  const cookieToken = req.cookies?.[config.authCookieName];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }

  return null;
}

export async function authenticateUser(req, _res, next) {
  try {
    const token = tokenFromRequest(req);
    if (!token) {
      throw new ApiError(401, "Authentication required.");
    }

    const payload = verifyAccessToken(token);
    const user = await findUserById(payload.sub);

    if (!user) {
      throw new ApiError(401, "Authentication required.");
    }

    req.user = publicUser(user);
    next();
  } catch (error) {
    next(error);
  }
}

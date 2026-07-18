import bcrypt from "bcryptjs";
import { ApiError } from "../errors.js";

const MIN_PASSWORD_LENGTH = 8;
const SALT_ROUNDS = 12;

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(422, "Password must be at least 8 characters long.", {
      minLength: MIN_PASSWORD_LENGTH
    });
  }
}

export async function hashPassword(password) {
  validatePassword(password);
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password, passwordHash) {
  if (!password || !passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

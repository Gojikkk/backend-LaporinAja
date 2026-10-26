import "dotenv/config";

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters");
}

const maxUploadRequestBytes = Number(process.env.MAX_UPLOAD_REQUEST_BYTES ?? 20 * 1024 * 1024);
if (!Number.isSafeInteger(maxUploadRequestBytes) || maxUploadRequestBytes < 1024 * 1024) {
  throw new Error("MAX_UPLOAD_REQUEST_BYTES must be an integer of at least 1 MB");
}

const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 7);
if (!Number.isSafeInteger(sessionTtlDays) || sessionTtlDays < 1) {
  throw new Error("SESSION_TTL_DAYS must be a positive integer");
}

export const env = {
  frontendOrigins: (process.env.FRONTEND_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  sessionSecret,
  sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === "true",
  sessionTtlDays,
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  maxUploadRequestBytes
};

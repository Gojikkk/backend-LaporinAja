import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { env } from "../config/env";
import { prisma } from "../db";
import { HttpError } from "../utils/http-error";

export const SESSION_COOKIE = "laporinaja_session";
export const CSRF_COOKIE = "laporinaja_csrf";
const sessionLifetimeMs = env.sessionTtlDays * 24 * 60 * 60 * 1000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readCookie(request: import("express").Request, key: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");
    if (separator > 0 && item.slice(0, separator).trim() === key) {
      try {
        return decodeURIComponent(item.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: env.sessionCookieSecure,
    sameSite: "lax" as const,
    path: "/",
    maxAge
  };
}

export async function createSession(userId: string): Promise<{ token: string; csrf: string }> {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      tokenHash: hash(token),
      csrfHash: hash(csrf),
      userId,
      expiresAt: new Date(Date.now() + sessionLifetimeMs)
    }
  });
  return { token, csrf };
}

export function setSessionCookies(response: Response, token: string, csrf: string): void {
  response.cookie(SESSION_COOKIE, token, sessionCookieOptions(sessionLifetimeMs));
  response.cookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure: env.sessionCookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: sessionLifetimeMs
  });
}

export function clearSessionCookies(response: Response): void {
  response.clearCookie(SESSION_COOKIE, sessionCookieOptions(0));
  response.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    secure: env.sessionCookieSecure,
    sameSite: "lax",
    path: "/"
  });
}

function matchesCsrf(expectedHash: string, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hash(supplied), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Silakan masuk terlebih dahulu");

    const session = await prisma.session.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: true }
    });
    if (!session || session.expiresAt <= new Date()) {
      throw new HttpError(401, "UNAUTHENTICATED", "Silakan masuk terlebih dahulu");
    }
    if (session.user.accountStatus !== "ACTIVE" || session.user.deletedAt) {
      throw new HttpError(403, "ACCOUNT_FORBIDDEN", "Akun tidak dapat digunakan");
    }

    request.user = {
      id: session.user.id,
      name: session.user.name,
      role: session.user.role,
      accountStatus: session.user.accountStatus
    };
    request.sessionToken = token;
    request.csrfHash = session.csrfHash;
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuth: RequestHandler = async (request, _response, next) => {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return next();
    const session = await prisma.session.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: true }
    });
    if (session && session.expiresAt > new Date() &&
        session.user.accountStatus === "ACTIVE" && !session.user.deletedAt) {
      request.user = {
        id: session.user.id,
        name: session.user.name,
        role: session.user.role,
        accountStatus: session.user.accountStatus
      };
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCsrf: RequestHandler = (request, _response, next) => {
  const cookie = readCookie(request, CSRF_COOKIE);
  if (!request.csrfHash || !matchesCsrf(request.csrfHash, cookie) ||
      request.get("X-CSRF-Token") !== cookie) {
    next(new HttpError(403, "CSRF_INVALID", "Token CSRF tidak valid"));
    return;
  }
  next();
};

export function requireRole(role: "PELAPOR" | "ADMIN"): RequestHandler {
  return (request, _response, next) => {
    if (!request.user) {
      next(new HttpError(401, "UNAUTHENTICATED", "Silakan masuk terlebih dahulu"));
    } else if (request.user.role !== role) {
      next(new HttpError(403, "FORBIDDEN", "Akses ditolak"));
    } else {
      next();
    }
  };
}

export async function revokeCurrentSession(token: string | undefined): Promise<void> {
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hash(token) } });
}

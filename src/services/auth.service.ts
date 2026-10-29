import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { prisma } from "../db";
import { createSession, revokeCurrentSession } from "../middlewares/auth";
import { HttpError } from "../utils/http-error";

type Credentials = {
  email: string;
  password: string;
};

const googleClient = new OAuth2Client();

function assertActiveAccount(user: { accountStatus: string; deletedAt: Date | null }): void {
  if (user.accountStatus !== "ACTIVE" || user.deletedAt) {
    throw new HttpError(403, "ACCOUNT_FORBIDDEN", "Akun tidak dapat digunakan");
  }
}

export async function registerUser(input: Credentials & { name: string }) {
  try {
    return await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await argon2.hash(input.password),
        role: "PELAPOR"
      },
      select: { id: true, name: true, role: true }
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new HttpError(409, "EMAIL_TAKEN", "Email sudah digunakan");
    }
    throw error;
  }
}

export async function loginUser(input: Credentials) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const valid = user ? await argon2.verify(user.passwordHash, input.password) : false;
  if (!user || !valid) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email atau password salah");
  }
  assertActiveAccount(user);

  return { user, session: await createSession(user.id) };
}

export async function loginWithGoogle(credential: string) {
  if (!env.googleClientId) {
    throw new HttpError(503, "GOOGLE_LOGIN_UNAVAILABLE", "Login Google belum dikonfigurasi");
  }

  let payload: { email?: string; email_verified?: boolean; name?: string } | undefined;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId
    });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(401, "GOOGLE_TOKEN_INVALID", "Token Google tidak valid");
  }

  if (!payload || !payload.email || !payload.email_verified) {
    throw new HttpError(401, "GOOGLE_TOKEN_INVALID", "Email Google belum terverifikasi");
  }

  const email = payload.email.trim().toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const fallbackName = email.split("@", 1)[0] || "Pengguna Google";
    user = await prisma.user.create({
      data: {
        name: (payload.name?.trim() || fallbackName).slice(0, 100),
        email,
        passwordHash: await argon2.hash(randomBytes(32).toString("base64url")),
        role: "PELAPOR"
      }
    });
  }
  assertActiveAccount(user);

  return { user, session: await createSession(user.id) };
}

export { revokeCurrentSession };

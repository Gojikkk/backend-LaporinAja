import { Router } from "express";
import argon2 from "argon2";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db";
import {
  clearSessionCookies,
  createSession,
  requireAuth,
  requireCsrf,
  revokeCurrentSession,
  setSessionCookies
} from "../middlewares/auth";
import { HttpError } from "../utils/http-error";
import { sendData } from "../utils/responses";
import { parseBody } from "../utils/validation";

const authRoutes = Router();
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({
    error: { code: "RATE_LIMITED", message: "Terlalu banyak percobaan. Coba lagi nanti." }
  })
});

const credentialsSchema = z.object({
  email: z.email("Email tidak valid").transform((email) => email.trim().toLowerCase()),
  password: z.string().min(8, "Password minimal 8 karakter").max(128, "Password maksimal 128 karakter")
});

authRoutes.post("/register", authRateLimit, async (request, response) => {
  const body = parseBody(z.object({
    name: z.string().trim().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
    ...credentialsSchema.shape
  }), request.body);

  try {
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        passwordHash: await argon2.hash(body.password),
        role: "PELAPOR"
      },
      select: { id: true, name: true, role: true }
    });
    sendData(response, user, 201);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new HttpError(409, "EMAIL_TAKEN", "Email sudah digunakan");
    }
    throw error;
  }
});

authRoutes.post("/login", authRateLimit, async (request, response) => {
  const body = parseBody(credentialsSchema, request.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  const valid = user ? await argon2.verify(user.passwordHash, body.password) : false;
  if (!user || !valid) throw new HttpError(401, "INVALID_CREDENTIALS", "Email atau password salah");
  if (user.accountStatus !== "ACTIVE" || user.deletedAt) {
    throw new HttpError(403, "ACCOUNT_FORBIDDEN", "Akun tidak dapat digunakan");
  }

  const session = await createSession(user.id);
  setSessionCookies(response, session.token, session.csrf);
  sendData(response, { id: user.id, name: user.name, role: user.role });
});

authRoutes.post("/logout", requireAuth, requireCsrf, async (request, response) => {
  await revokeCurrentSession(request.sessionToken);
  clearSessionCookies(response);
  sendData(response, { ok: true });
});

authRoutes.get("/me", requireAuth, (request, response) => {
  sendData(response, {
    id: request.user!.id,
    name: request.user!.name,
    role: request.user!.role
  });
});

export default authRoutes;

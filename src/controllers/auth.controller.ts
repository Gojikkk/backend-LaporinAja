import type { RequestHandler } from "express";
import { clearSessionCookies, setSessionCookies } from "../middlewares/auth";
import { loginUser, loginWithGoogle, registerUser, revokeCurrentSession } from "../services/auth.service";
import { sendData } from "../utils/responses";
import { parseBody } from "../utils/validation";
import { z } from "zod";

const credentialsSchema = z.object({
  email: z.email("Email tidak valid").transform((email) => email.trim().toLowerCase()),
  password: z.string().min(8, "Password minimal 8 karakter").max(128, "Password maksimal 128 karakter")
});

const registrationSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(100, "Nama maksimal 100 karakter"),
  ...credentialsSchema.shape
});

const googleCredentialSchema = z.object({
  credential: z.string().trim().min(1, "Token Google wajib diisi")
});

export const register: RequestHandler = async (request, response) => {
  const user = await registerUser(parseBody(registrationSchema, request.body));
  sendData(response, user, 201);
};

export const login: RequestHandler = async (request, response) => {
  const { user, session } = await loginUser(parseBody(credentialsSchema, request.body));
  setSessionCookies(response, session.token, session.csrf);
  sendData(response, { id: user.id, name: user.name, role: user.role });
};

export const loginGoogle: RequestHandler = async (request, response) => {
  const { user, session } = await loginWithGoogle(parseBody(googleCredentialSchema, request.body).credential);
  setSessionCookies(response, session.token, session.csrf);
  sendData(response, { id: user.id, name: user.name, role: user.role });
};

export const logout: RequestHandler = async (request, response) => {
  await revokeCurrentSession(request.sessionToken);
  clearSessionCookies(response);
  sendData(response, { ok: true });
};

export const me: RequestHandler = (request, response) => {
  sendData(response, {
    id: request.user!.id,
    name: request.user!.name,
    role: request.user!.role
  });
};

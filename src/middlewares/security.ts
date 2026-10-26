import type { RequestHandler } from "express";
import { env } from "../config/env";
import { HttpError } from "../utils/http-error";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const corsAndOrigin: RequestHandler = (request, response, next) => {
  const origin = request.get("Origin");
  if (origin && !env.frontendOrigins.includes(origin)) {
    next(new HttpError(403, "ORIGIN_FORBIDDEN", "Origin tidak diizinkan"));
    return;
  }

  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");

  if (request.method === "OPTIONS") {
    if (!origin) {
      next(new HttpError(403, "ORIGIN_FORBIDDEN", "Origin tidak diizinkan"));
      return;
    }
    response.sendStatus(204);
    return;
  }

  if (!safeMethods.has(request.method) && request.path.startsWith("/api/")) {
    if (!origin || !env.frontendOrigins.includes(origin)) {
      next(new HttpError(403, "ORIGIN_FORBIDDEN", "Origin tidak diizinkan"));
      return;
    }
  }
  next();
};

import type { Request } from "express";
import { z } from "zod";
import { HttpError } from "./http-error";

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const message = /^(Invalid|Too small|Too big|Expected|Unrecognized|Too large)/i.test(issue.message)
      ? "Nilai tidak valid"
      : issue.message;
    fields[issue.path.join(".") || "request"] ??= message;
  }
  throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", fields);
}

export function parseQuery<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const message = /^(Invalid|Too small|Too big|Expected|Unrecognized|Too large)/i.test(issue.message)
      ? "Nilai parameter tidak valid"
      : issue.message;
    fields[issue.path.join(".") || "query"] ??= message;
  }
  throw new HttpError(400, "BAD_REQUEST", "Parameter permintaan tidak valid", fields);
}

export function pagination(request: Request): { page: number; limit: number } {
  return parseQuery(z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12)
  }), request.query);
}

export function listMeta(page: number, limit: number, total: number) {
  return { page, limit, total };
}

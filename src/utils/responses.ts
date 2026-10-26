import type { Response } from "express";

export function sendData<T>(response: Response, data: T, status = 200): void {
  response.status(status).json({ data });
}

export function sendList<T>(
  response: Response,
  data: T[],
  meta: { page: number; limit: number; total: number },
  counts?: Record<string, number>
): void {
  response.status(200).json(counts ? { data, meta, counts } : { data, meta });
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

const lifetimeSeconds = 15 * 60;

function sign(evidenceId: string, expires: number): string {
  return createHmac("sha256", env.sessionSecret)
    .update(`${evidenceId}:${expires}`)
    .digest("hex");
}

export function mediaUrl(evidenceId: string): string {
  const expires = Math.floor(Date.now() / 1000) + lifetimeSeconds;
  return `/api/media/${evidenceId}?expires=${expires}&signature=${sign(evidenceId, expires)}`;
}

export function validMediaSignature(evidenceId: string, expires: number, signature: string): boolean {
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(evidenceId, expires), "hex");
  const supplied = Buffer.from(signature, "hex");
  return supplied.length === expected.length && timingSafeEqual(expected, supplied);
}

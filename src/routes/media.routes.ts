import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { optionalAuth } from "../middlewares/auth";
import { HttpError } from "../utils/http-error";
import { validMediaSignature } from "../utils/media-signature";
import { imagePath } from "../utils/uploads";
import { ReportStatus } from "@prisma/client";

const mediaRoutes = Router();
const publicStatuses: ReportStatus[] = ["VERIFIED", "IN_PROGRESS", "RESOLVED", "DUPLICATE"];

mediaRoutes.get("/media/:id", optionalAuth, async (request, response, next) => {
  const id = request.params.id;
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) {
    throw new HttpError(404, "NOT_FOUND", "File tidak ditemukan");
  }
  const query = z.object({
    expires: z.coerce.number().int(),
    signature: z.string().regex(/^[a-f0-9]{64}$/)
  }).safeParse(request.query);
  if (!query.success || !validMediaSignature(id, query.data.expires, query.data.signature)) {
    throw new HttpError(404, "NOT_FOUND", "File tidak ditemukan");
  }

  const evidence = await prisma.reportEvidence.findUnique({
    where: { id },
    include: { report: { select: { reporterId: true, status: true, isHidden: true } } }
  });
  if (!evidence) throw new HttpError(404, "NOT_FOUND", "File tidak ditemukan");

  const isPublic = !evidence.report.isHidden && publicStatuses.includes(evidence.report.status);
  const isOwner = request.user?.id === evidence.report.reporterId;
  const isAdmin = request.user?.role === "ADMIN";
  if (!isPublic && !isOwner && !isAdmin) {
    throw new HttpError(404, "NOT_FOUND", "File tidak ditemukan");
  }

  response.type(evidence.mimeType);
  response.setHeader("Cache-Control", "private, max-age=60");
  response.sendFile(imagePath(evidence.storageKey), (error) => {
    if (error && !response.headersSent) next(new HttpError(404, "NOT_FOUND", "File tidak ditemukan"));
  });
});

export default mediaRoutes;

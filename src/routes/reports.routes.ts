import { Router } from "express";
import multer from "multer";
import { Prisma, ReportStatus } from "@prisma/client";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../db";
import { requireAuth, requireCsrf, requireRole } from "../middlewares/auth";
import { generatePublicCode } from "../public-code";
import { HttpError } from "../utils/http-error";
import { mediaUrl } from "../utils/media-signature";
import { sendData, sendList } from "../utils/responses";
import { deleteStoredImages, storeImages } from "../utils/uploads";
import { listMeta, pagination, parseBody, parseQuery } from "../utils/validation";

const reportsRoutes = Router();
const statusSchema = z.enum(["SUBMITTED", "VERIFIED", "IN_PROGRESS", "RESOLVED", "REJECTED", "DUPLICATE"]);
const publicStatuses: ReportStatus[] = ["VERIFIED", "IN_PROGRESS", "RESOLVED", "DUPLICATE"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 3,
    fileSize: 5 * 1024 * 1024,
    fields: 8,
    fieldSize: 5 * 1024,
    parts: 11
  }
});

const publicDetailInclude = {
  category: true,
  evidences: { orderBy: { createdAt: "asc" as const } },
  statusHistories: { orderBy: { createdAt: "asc" as const } },
  followUps: { orderBy: { createdAt: "asc" as const }, include: { evidences: true } }
} satisfies Prisma.ReportInclude;
type PublicDetail = Prisma.ReportGetPayload<{ include: typeof publicDetailInclude }>;

const ownerDetailInclude = {
  ...publicDetailInclude,
  statusHistories: {
    orderBy: { createdAt: "asc" as const },
    include: { user: { select: { role: true } } }
  }
} satisfies Prisma.ReportInclude;
type OwnerDetail = Prisma.ReportGetPayload<{ include: typeof ownerDetailInclude }>;

const adminDetailInclude = {
  ...ownerDetailInclude,
  reporter: { select: { name: true } }
} satisfies Prisma.ReportInclude;
type AdminDetail = Prisma.ReportGetPayload<{ include: typeof adminDetailInclude }>;

function checkUploadRequestSize(request: import("express").Request): void {
  const length = Number(request.get("Content-Length") ?? 0);
  if (length > env.maxUploadRequestBytes) {
    throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
      request: "Ukuran permintaan melebihi batas"
    });
  }
}

function getCode(request: import("express").Request): string {
  const code = request.params.code;
  if (typeof code !== "string" || !/^LPR-\d{4}-\d{6,}$/.test(code)) {
    throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  }
  return code;
}

function uploadMiddleware(request: import("express").Request, response: import("express").Response, next: import("express").NextFunction): void {
  checkUploadRequestSize(request);
  upload.array("photos", 3)(request, response, next);
}

function reportPhotos(evidences: PublicDetail["evidences"]) {
  return evidences
    .filter((evidence) => evidence.kind === "REPORT_PHOTO")
    .map((evidence) => ({ url: mediaUrl(evidence.id), mimeType: evidence.mimeType }));
}

function publicReportDto(report: PublicDetail, detail = false) {
  const photos = reportPhotos(report.evidences);
  const dto = {
    code: report.publicCode,
    title: report.title,
    category: { id: report.category.id, name: report.category.name, slug: report.category.slug },
    district: report.district,
    village: report.village,
    status: report.status,
    thumbnailUrl: photos[0]?.url ?? null,
    createdAt: report.createdAt.toISOString()
  };
  if (!detail) return dto;

  return {
    ...dto,
    description: report.description,
    city: report.city,
    locationDetail: report.locationDetail,
    photos,
    timeline: report.statusHistories
      .filter((history) => history.toStatus !== "REJECTED" && history.fromStatus !== "REJECTED")
      .map((history) => ({
        fromStatus: history.fromStatus,
        toStatus: history.toStatus,
        createdAt: history.createdAt.toISOString(),
        actorLabel: "Administrator platform",
        reason: null
      })),
    followUps: report.followUps.map((followUp) => ({
      note: followUp.note,
      isResolutionNote: followUp.isResolutionNote,
      resolutionExplanation: followUp.resolutionExplanation,
      createdAt: followUp.createdAt.toISOString()
    })),
    evidences: report.evidences
      .filter((evidence) => evidence.kind === "RESOLUTION_PROOF")
      .map((evidence) => ({
        url: mediaUrl(evidence.id),
        mimeType: evidence.mimeType,
        altText: evidence.altText,
        createdAt: evidence.createdAt.toISOString()
      }))
  };
}

function ownerReportDto(report: OwnerDetail) {
  const publicDto = publicReportDto(report, true);
  return {
    ...publicDto,
    timeline: report.statusHistories.map((history) => ({
      fromStatus: history.fromStatus,
      toStatus: history.toStatus,
      reason: history.reason,
      createdAt: history.createdAt.toISOString(),
      actorLabel: history.user.role === "ADMIN" ? "Administrator platform" : "Pelapor"
    })),
    followUps: report.followUps.map((followUp) => ({
      id: followUp.id,
      note: followUp.note,
      isResolutionNote: followUp.isResolutionNote,
      resolutionExplanation: followUp.resolutionExplanation,
      createdAt: followUp.createdAt.toISOString(),
      evidences: followUp.evidences.map((evidence) => ({
        url: mediaUrl(evidence.id),
        mimeType: evidence.mimeType,
        altText: evidence.altText
      }))
    }))
  };
}

function adminReportDto(report: AdminDetail) {
  return {
    ...ownerReportDto(report),
    reporterName: report.reporter.name,
    isHidden: report.isHidden
  };
}

function emptyStatusCounts(rows: Array<{ status: ReportStatus; count: bigint }>): Record<ReportStatus, number> {
  const counts: Record<ReportStatus, number> = {
    SUBMITTED: 0, VERIFIED: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0, DUPLICATE: 0
  };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

reportsRoutes.get("/categories", async (_request, response) => {
  const categories = await prisma.reportCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: { id: "asc" }
  });
  sendData(response, categories);
});

reportsRoutes.get("/reports", async (request, response) => {
  const { page, limit } = pagination(request);
  const filters = parseQuery(z.object({
    category: z.string().trim().min(1).optional(),
    status: statusSchema.optional(),
    district: z.string().trim().min(1).optional(),
    village: z.string().trim().min(1).optional()
  }), request.query);
  const where: Prisma.ReportWhereInput = {
    isHidden: false,
    status: { in: filters.status ? [filters.status] : publicStatuses },
    ...(filters.category ? { category: { slug: filters.category } } : {}),
    ...(filters.district ? { district: filters.district } : {}),
    ...(filters.village ? { village: filters.village } : {})
  };
  const [total, reports] = await prisma.$transaction([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      include: {
        category: true,
        evidences: { where: { kind: "REPORT_PHOTO" }, orderBy: { createdAt: "asc" } }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    })
  ]);
  sendList(response, reports.map((report) => ({
    code: report.publicCode,
    title: report.title,
    category: { id: report.category.id, name: report.category.name, slug: report.category.slug },
    district: report.district,
    village: report.village,
    status: report.status,
    thumbnailUrl: report.evidences[0] ? mediaUrl(report.evidences[0].id) : null,
    createdAt: report.createdAt.toISOString()
  })), listMeta(page, limit, total));
});

reportsRoutes.get("/reports/:code", async (request, response) => {
  const code = getCode(request);
  const report = await prisma.report.findFirst({
    where: { publicCode: code, isHidden: false, status: { in: publicStatuses } },
    include: publicDetailInclude
  });
  if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  sendData(response, publicReportDto(report, true));
});

reportsRoutes.post(
  "/reports",
  requireAuth,
  requireRole("PELAPOR"),
  requireCsrf,
  uploadMiddleware,
  async (request, response) => {
    const body = parseBody(z.object({
      categoryId: z.coerce.number().int().positive(),
      title: z.string().trim().min(10, "Judul minimal 10 karakter").max(100, "Judul maksimal 100 karakter"),
      description: z.string().trim().min(30, "Deskripsi minimal 30 karakter").max(1000, "Deskripsi maksimal 1000 karakter"),
      city: z.string().trim().min(1, "Kota wajib diisi").max(100),
      district: z.string().trim().min(1, "Kecamatan wajib diisi").max(100),
      village: z.string().trim().min(1, "Kelurahan wajib diisi").max(100),
      locationDetail: z.string().trim().min(5, "Patokan minimal 5 karakter").max(200),
      submissionKey: z.uuid("submissionKey harus UUID")
    }), request.body);
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length < 1) {
      throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", { photos: "Unggah 1 sampai 3 foto" });
    }

    const keyWhere = {
      reporterId_submissionKey: { reporterId: request.user!.id, submissionKey: body.submissionKey }
    };
    const existing = await prisma.report.findUnique({ where: keyWhere, select: { publicCode: true, status: true } });
    if (existing) {
      sendData(response, { code: existing.publicCode, status: existing.status });
      return;
    }

    const category = await prisma.reportCategory.findFirst({
      where: { id: body.categoryId, isActive: true },
      select: { id: true }
    });
    if (!category) throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
      categoryId: "Kategori tidak tersedia"
    });

    const filesOnDisk = await storeImages(files);
    try {
      const publicCode = await generatePublicCode(prisma);
      const report = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${request.user!.id}))`;
        const recentCount = await tx.report.count({
          where: {
            reporterId: request.user!.id,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        });
        if (recentCount >= 5) {
          throw new HttpError(429, "RATE_LIMITED", "Batas 5 laporan per 24 jam tercapai");
        }
        const created = await tx.report.create({
          data: {
            ...body,
            reporterId: request.user!.id,
            publicCode,
            status: "SUBMITTED"
          }
        });
        await tx.reportStatusHistory.create({
          data: {
            reportId: created.id,
            fromStatus: null,
            toStatus: "SUBMITTED",
            changedBy: request.user!.id
          }
        });
        await tx.reportEvidence.createMany({
          data: filesOnDisk.map((file) => ({
            reportId: created.id,
            uploadedBy: request.user!.id,
            kind: "REPORT_PHOTO",
            ...file
          }))
        });
        return created;
      });
      sendData(response, { code: report.publicCode, status: report.status }, 201);
    } catch (error) {
      await deleteStoredImages(filesOnDisk.map(({ storageKey }) => storageKey));
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        const concurrentRetry = await prisma.report.findUnique({
          where: keyWhere,
          select: { publicCode: true, status: true }
        });
        if (concurrentRetry) {
          sendData(response, { code: concurrentRetry.publicCode, status: concurrentRetry.status });
          return;
        }
      }
      throw error;
    }
  }
);

reportsRoutes.get("/me/reports", requireAuth, requireRole("PELAPOR"), async (request, response) => {
  const { page, limit } = pagination(request);
  const filters = parseQuery(z.object({ status: statusSchema.optional() }), request.query);
  const where: Prisma.ReportWhereInput = {
    reporterId: request.user!.id,
    ...(filters.status ? { status: filters.status } : {})
  };
  const [total, reports, grouped] = await prisma.$transaction([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      include: {
        category: true,
        evidences: { where: { kind: "REPORT_PHOTO" }, orderBy: { createdAt: "asc" } }
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.$queryRaw<Array<{ status: ReportStatus; count: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count
      FROM reports
      WHERE reporter_id = ${request.user!.id}::uuid
      GROUP BY status
    `
  ]);
  sendList(response, reports.map((report) => ({
    code: report.publicCode,
    title: report.title,
    category: { id: report.category.id, name: report.category.name, slug: report.category.slug },
    district: report.district,
    village: report.village,
    status: report.status,
    thumbnailUrl: report.evidences[0] ? mediaUrl(report.evidences[0].id) : null,
    createdAt: report.createdAt.toISOString()
  })), listMeta(page, limit, total), emptyStatusCounts(grouped));
});

reportsRoutes.get("/me/reports/:code", requireAuth, requireRole("PELAPOR"), async (request, response) => {
  const code = getCode(request);
  const report = await prisma.report.findFirst({
    where: { publicCode: code, reporterId: request.user!.id },
    include: ownerDetailInclude
  });
  if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  sendData(response, ownerReportDto(report));
});

reportsRoutes.get("/admin/reports", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const { page, limit } = pagination(request);
  const filters = parseQuery(z.object({
    status: statusSchema.optional(),
    category: z.string().trim().min(1).optional()
  }), request.query);
  const where: Prisma.ReportWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.category ? { category: { slug: filters.category } } : {})
  };
  const [total, reports, grouped] = await prisma.$transaction([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      include: adminDetailInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.$queryRaw<Array<{ status: ReportStatus; count: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count
      FROM reports
      GROUP BY status
    `
  ]);
  sendList(response, reports.map(adminReportDto), listMeta(page, limit, total), emptyStatusCounts(grouped));
});

reportsRoutes.get("/admin/reports/:code", requireAuth, requireRole("ADMIN"), async (request, response) => {
  const code = getCode(request);
  const report = await prisma.report.findUnique({
    where: { publicCode: code },
    include: adminDetailInclude
  });
  if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  sendData(response, adminReportDto(report));
});

reportsRoutes.post(
  "/admin/reports/:code/follow-ups",
  requireAuth,
  requireRole("ADMIN"),
  requireCsrf,
  uploadMiddleware,
  async (request, response) => {
    const code = getCode(request);
    const body = parseBody(z.object({
      note: z.string().trim().min(10, "Catatan minimal 10 karakter").max(500, "Catatan maksimal 500 karakter"),
      isResolutionNote: z.preprocess(
        (value) => value === "true" ? true : value === "false" ? false : value,
        z.boolean()
      ),
      resolutionExplanation: z.string().trim().max(500, "Penjelasan maksimal 500 karakter").optional()
    }), request.body);
    const files = (request.files as Express.Multer.File[] | undefined) ?? [];
    if (body.isResolutionNote && files.length === 0 && (body.resolutionExplanation?.length ?? 0) < 30) {
      throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
        resolutionExplanation: "Penjelasan minimal 30 karakter jika tanpa foto bukti"
      });
    }
    const report = await prisma.report.findUnique({
      where: { publicCode: code },
      select: { id: true, status: true }
    });
    if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
    if (report.status !== "VERIFIED" && report.status !== "IN_PROGRESS") {
      throw new HttpError(422, "INVALID_TRANSITION", "Catatan hanya dapat ditambahkan pada laporan VERIFIED atau IN_PROGRESS");
    }

    const filesOnDisk = await storeImages(files);
    try {
      const followUp = await prisma.$transaction(async (tx) => {
        const lockedReports = await tx.$queryRaw<Array<{ status: ReportStatus }>>`
          SELECT status::text AS status FROM reports WHERE id = ${report.id}::uuid FOR UPDATE
        `;
        const lockedReport = lockedReports[0];
        if (!lockedReport) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
        if (lockedReport.status !== "VERIFIED" && lockedReport.status !== "IN_PROGRESS") {
          throw new HttpError(422, "INVALID_TRANSITION", "Catatan hanya dapat ditambahkan pada laporan VERIFIED atau IN_PROGRESS");
        }
        const created = await tx.reportFollowUp.create({
          data: {
            reportId: report.id,
            createdBy: request.user!.id,
            note: body.note,
            isResolutionNote: body.isResolutionNote,
            resolutionExplanation: body.resolutionExplanation ?? null
          }
        });
        if (filesOnDisk.length) {
          await tx.reportEvidence.createMany({
            data: filesOnDisk.map((file) => ({
              reportId: report.id,
              followUpId: created.id,
              uploadedBy: request.user!.id,
              kind: "RESOLUTION_PROOF",
              ...file
            }))
          });
        }
        return created;
      });
      sendData(response, {
        id: followUp.id,
        note: followUp.note,
        createdAt: followUp.createdAt.toISOString()
      }, 201);
    } catch (error) {
      await deleteStoredImages(filesOnDisk.map(({ storageKey }) => storageKey));
      throw error;
    }
  }
);

reportsRoutes.post("/admin/reports/:code/status", requireAuth, requireRole("ADMIN"), requireCsrf, async (request, response) => {
  const code = getCode(request);
  const body = parseBody(z.object({
    toStatus: statusSchema,
    expectedStatus: statusSchema,
    reason: z.string().trim().optional()
  }), request.body);
  const report = await prisma.report.findUnique({
    where: { publicCode: code },
    select: { id: true, status: true }
  });
  if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  if (report.status !== body.expectedStatus) {
    throw new HttpError(409, "STATUS_CONFLICT", "Status laporan sudah berubah");
  }

  const allowed: Partial<Record<ReportStatus, ReportStatus[]>> = {
    SUBMITTED: ["VERIFIED", "REJECTED"],
    VERIFIED: ["IN_PROGRESS", "REJECTED"],
    IN_PROGRESS: ["RESOLVED"],
    REJECTED: ["SUBMITTED"]
  };
  if (!allowed[report.status]?.includes(body.toStatus)) {
    throw new HttpError(422, "INVALID_TRANSITION", "Perubahan status tidak diizinkan");
  }
  if ((body.toStatus === "REJECTED" || report.status === "REJECTED") &&
      (body.reason?.length ?? 0) < 10) {
    throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
      reason: "Alasan minimal 10 karakter"
    });
  }

  const history = await prisma.$transaction(async (tx) => {
    const lockedReports = await tx.$queryRaw<Array<{ status: ReportStatus }>>`
      SELECT status::text AS status FROM reports WHERE id = ${report.id}::uuid FOR UPDATE
    `;
    const lockedReport = lockedReports[0];
    if (!lockedReport) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
    if (lockedReport.status !== body.expectedStatus) {
      throw new HttpError(409, "STATUS_CONFLICT", "Status laporan sudah berubah");
    }

    if (body.toStatus === "RESOLVED") {
      const closure = await tx.reportFollowUp.findFirst({
        where: {
          reportId: report.id,
          isResolutionNote: true,
          note: { not: "" },
          OR: [
            { resolutionExplanation: { not: null } },
            { evidences: { some: { kind: "RESOLUTION_PROOF" } } }
          ]
        },
        select: { id: true, resolutionExplanation: true, evidences: { select: { id: true } } }
      });
      const explanationPresent = (closure?.resolutionExplanation?.trim().length ?? 0) >= 30;
      if (!closure || (!closure.evidences.length && !explanationPresent)) {
        throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
          resolutionExplanation: "Penyelesaian wajib memiliki catatan serta foto bukti atau penjelasan minimal 30 karakter"
        });
      }
    }

    const updated = await tx.report.updateMany({
      where: { id: report.id, status: body.expectedStatus },
      data: {
        status: body.toStatus,
        ...(body.toStatus === "VERIFIED" ? { verifiedAt: new Date() } : {}),
        ...(body.toStatus === "RESOLVED" ? { resolvedAt: new Date() } : {})
      }
    });
    if (updated.count !== 1) throw new HttpError(409, "STATUS_CONFLICT", "Status laporan sudah berubah");
    return tx.reportStatusHistory.create({
      data: {
        reportId: report.id,
        fromStatus: body.expectedStatus,
        toStatus: body.toStatus,
        changedBy: request.user!.id,
        reason: body.reason ?? null
      },
      select: { id: true }
    });
  });
  sendData(response, { code, status: body.toStatus, historyId: history.id });
});

export default reportsRoutes;

import { Prisma, ReportStatus } from "@prisma/client";
import { prisma } from "../db";
import { generatePublicCode } from "../public-code";
import { HttpError } from "../utils/http-error";
import { mediaUrl } from "../utils/media-signature";
import { deleteStoredImages, storeImages } from "../utils/uploads";

export const publicStatusValues = ["VERIFIED", "IN_PROGRESS", "RESOLVED", "DUPLICATE"] as const;
export const publicStatuses: ReportStatus[] = [...publicStatusValues];

const reportCodePattern = /^LPR-\d{4}-\d{6,}$/;

export type PublicReportFilters = {
  category?: string;
  status?: (typeof publicStatusValues)[number];
  district?: string;
  village?: string;
};

export type CreateReportInput = {
  categoryId: number;
  title: string;
  description: string;
  city: string;
  district: string;
  village: string;
  locationDetail: string;
  submissionKey: string;
};

export type FollowUpInput = {
  note: string;
  isResolutionNote: boolean;
  resolutionExplanation?: string;
};

export type StatusChangeInput = {
  toStatus: ReportStatus;
  expectedStatus: ReportStatus;
  reason?: string;
};

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

const reportListInclude = {
  category: true,
  evidences: { where: { kind: "REPORT_PHOTO" as const }, orderBy: { createdAt: "asc" as const } }
} satisfies Prisma.ReportInclude;
type ReportList = Prisma.ReportGetPayload<{ include: typeof reportListInclude }>;

function publicReportListDto(report: ReportList) {
  const thumbnail = report.evidences[0];
  return {
    code: report.publicCode,
    title: report.title,
    category: { id: report.category.id, name: report.category.name, slug: report.category.slug },
    district: report.district,
    village: report.village,
    status: report.status,
    thumbnailUrl: thumbnail ? mediaUrl(thumbnail.id) : null,
    createdAt: report.createdAt.toISOString()
  };
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

export function assertReportCode(code: unknown): string {
  if (typeof code !== "string" || !reportCodePattern.test(code)) {
    throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  }
  return code;
}

export async function listCategories() {
  return prisma.reportCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: { id: "asc" }
  });
}

export async function listPublicReports(
  page: number,
  limit: number,
  filters: PublicReportFilters
) {
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
      include: reportListInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    })
  ]);
  return {
    total,
    data: reports.map((report) => publicReportListDto(report))
  };
}

export async function getPublicReport(code: string) {
  const report = await prisma.report.findFirst({
    where: { publicCode: code, isHidden: false, status: { in: publicStatuses } },
    include: publicDetailInclude
  });
  if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  return publicReportDto(report, true);
}

export async function createReport(
  reporterId: string,
  body: CreateReportInput,
  files: Express.Multer.File[]
) {
  if (files.length < 1) {
    throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", { photos: "Unggah 1 sampai 3 foto" });
  }

  const keyWhere = {
    reporterId_submissionKey: { reporterId, submissionKey: body.submissionKey }
  };
  const existing = await prisma.report.findUnique({
    where: keyWhere,
    select: { publicCode: true, status: true }
  });
  if (existing) {
    return { code: existing.publicCode, status: existing.status, created: false };
  }

  const category = await prisma.reportCategory.findFirst({
    where: { id: body.categoryId, isActive: true },
    select: { id: true }
  });
  if (!category) {
    throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
      categoryId: "Kategori tidak tersedia"
    });
  }

  const filesOnDisk = await storeImages(files);
  try {
    const publicCode = await generatePublicCode(prisma);
    const report = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reporterId}))::text`;
      const recentCount = await tx.report.count({
        where: {
          reporterId,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
      });
      if (recentCount >= 5) {
        throw new HttpError(429, "RATE_LIMITED", "Batas 5 laporan per 24 jam tercapai");
      }
      const created = await tx.report.create({
        data: {
          ...body,
          reporterId,
          publicCode,
          status: "SUBMITTED"
        }
      });
      await tx.reportStatusHistory.create({
        data: {
          reportId: created.id,
          fromStatus: null,
          toStatus: "SUBMITTED",
          changedBy: reporterId
        }
      });
      await tx.reportEvidence.createMany({
        data: filesOnDisk.map((file) => ({
          reportId: created.id,
          uploadedBy: reporterId,
          kind: "REPORT_PHOTO",
          ...file
        }))
      });
      return created;
    });
    return { code: report.publicCode, status: report.status, created: true };
  } catch (error) {
    await deleteStoredImages(filesOnDisk.map(({ storageKey }) => storageKey));
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const concurrentRetry = await prisma.report.findUnique({
        where: keyWhere,
        select: { publicCode: true, status: true }
      });
      if (concurrentRetry) {
        return { code: concurrentRetry.publicCode, status: concurrentRetry.status, created: false };
      }
    }
    throw error;
  }
}

export async function listOwnerReports(
  reporterId: string,
  page: number,
  limit: number,
  status?: ReportStatus
) {
  const where: Prisma.ReportWhereInput = {
    reporterId,
    ...(status ? { status } : {})
  };
  const [total, reports, grouped] = await prisma.$transaction([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      include: reportListInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit
    }),
    prisma.$queryRaw<Array<{ status: ReportStatus; count: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count
      FROM reports
      WHERE reporter_id = ${reporterId}::uuid
      GROUP BY status
    `
  ]);
  return {
    total,
    counts: emptyStatusCounts(grouped),
    data: reports.map((report) => publicReportListDto(report))
  };
}

export async function getOwnerReport(reporterId: string, code: string) {
  const report = await prisma.report.findFirst({
    where: { publicCode: code, reporterId },
    include: ownerDetailInclude
  });
  if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  return ownerReportDto(report);
}

export async function listAdminReports(
  page: number,
  limit: number,
  filters: { status?: ReportStatus; category?: string }
) {
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
  return {
    total,
    counts: emptyStatusCounts(grouped),
    data: reports.map((report) => adminReportDto(report))
  };
}

export async function getAdminReport(code: string) {
  const report = await prisma.report.findUnique({
    where: { publicCode: code },
    include: adminDetailInclude
  });
  if (!report) throw new HttpError(404, "NOT_FOUND", "Laporan tidak ditemukan");
  return adminReportDto(report);
}

export async function addFollowUp(
  adminId: string,
  code: string,
  body: FollowUpInput,
  files: Express.Multer.File[]
) {
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
    return await prisma.$transaction(async (tx) => {
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
          createdBy: adminId,
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
            uploadedBy: adminId,
            kind: "RESOLUTION_PROOF",
            ...file
          }))
        });
      }
      return created;
    });
  } catch (error) {
    await deleteStoredImages(filesOnDisk.map(({ storageKey }) => storageKey));
    throw error;
  }
}

export async function changeReportStatus(
  adminId: string,
  code: string,
  body: StatusChangeInput
) {
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
        changedBy: adminId,
        reason: body.reason ?? null
      },
      select: { id: true }
    });
  });
  return { code, status: body.toStatus, historyId: history.id };
}

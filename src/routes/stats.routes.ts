import { Router } from "express";
import { ReportStatus } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { sendData } from "../utils/responses";

const statsRoutes = Router();
const publicStatuses: ReportStatus[] = ["VERIFIED", "IN_PROGRESS", "RESOLVED", "DUPLICATE"];

function countsByStatus(rows: Array<{ status: ReportStatus; count: bigint }>): Record<ReportStatus, number> {
  const counts: Record<ReportStatus, number> = {
    SUBMITTED: 0, VERIFIED: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0, DUPLICATE: 0
  };
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}

function percentagesByStatus(counts: Record<ReportStatus, number>, total: number): Record<ReportStatus, number> {
  return Object.fromEntries(
    Object.entries(counts).map(([status, count]) => [status, percentage(count, total)])
  ) as Record<ReportStatus, number>;
}

function percentage(numerator: number, denominator: number): number {
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

statsRoutes.get("/stats/public", async (_request, response) => {
  const where = { isHidden: false, status: { in: publicStatuses } };
  const [total, grouped, categoryCounts] = await Promise.all([
    prisma.report.count({ where }),
    prisma.$queryRaw<Array<{ status: ReportStatus; count: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count
      FROM reports
      WHERE is_hidden = false
        AND status IN ('VERIFIED'::report_status, 'IN_PROGRESS'::report_status,
                       'RESOLVED'::report_status, 'DUPLICATE'::report_status)
      GROUP BY status
    `,
    prisma.$queryRaw<Array<{ id: number; name: string; slug: string; count: bigint }>>`
      SELECT c.id, c.name, c.slug, COUNT(r.id)::bigint AS count
      FROM report_categories c
      JOIN reports r ON r.category_id = c.id
      WHERE r.is_hidden = false
        AND r.status IN ('VERIFIED'::report_status, 'IN_PROGRESS'::report_status,
                         'RESOLVED'::report_status, 'DUPLICATE'::report_status)
      GROUP BY c.id, c.name, c.slug
      ORDER BY c.id
    `
  ]);
  const byStatus = countsByStatus(grouped);
  const completionDenominator = byStatus.VERIFIED + byStatus.IN_PROGRESS + byStatus.RESOLVED;

  sendData(response, {
    total,
    byStatus,
    statusDistribution: percentagesByStatus(byStatus, total),
    byCategory: categoryCounts.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      count: Number(row.count)
    })),
    resolved: byStatus.RESOLVED,
    completionRate: percentage(byStatus.RESOLVED, completionDenominator),
    asOf: new Date().toISOString(),
    label: "Data demonstrasi"
  });
});

statsRoutes.get("/admin/stats", requireAuth, requireRole("ADMIN"), async (_request, response) => {
  const [total, grouped, followUpCoverage, resolvedEvidence, verifiedHistories] = await Promise.all([
    prisma.report.count(),
    prisma.$queryRaw<Array<{ status: ReportStatus; count: bigint }>>`
      SELECT status::text AS status, COUNT(*)::bigint AS count
      FROM reports
      GROUP BY status
    `,
    prisma.$queryRaw<Array<{ eligible: bigint; covered: bigint }>>`
      SELECT
        COUNT(DISTINCT r.id)::bigint AS eligible,
        COUNT(DISTINCT f.report_id)::bigint AS covered
      FROM reports r
      LEFT JOIN report_follow_ups f ON f.report_id = r.id
      WHERE r.status IN ('VERIFIED'::report_status, 'IN_PROGRESS'::report_status,
                         'RESOLVED'::report_status)
    `,
    prisma.$queryRaw<Array<{ resolved: bigint; withProof: bigint }>>`
      SELECT
        COUNT(DISTINCT r.id)::bigint AS resolved,
        COUNT(DISTINCT CASE
          WHEN e.id IS NOT NULL OR
               (f.is_resolution_note = true AND length(trim(f.resolution_explanation)) >= 30)
          THEN r.id
        END)::bigint AS "withProof"
      FROM reports r
      LEFT JOIN report_follow_ups f ON f.report_id = r.id
      LEFT JOIN report_evidences e
        ON e.report_id = r.id AND e.kind = 'RESOLUTION_PROOF'::evidence_kind
      WHERE r.status = 'RESOLVED'::report_status
    `,
    prisma.reportStatusHistory.findMany({
      where: { toStatus: "VERIFIED" },
      select: { reportId: true, createdAt: true, report: { select: { createdAt: true } } },
      orderBy: { createdAt: "asc" },
      distinct: ["reportId"]
    })
  ]);
  const byStatus = countsByStatus(grouped);
  const verifiedCount = byStatus.VERIFIED + byStatus.IN_PROGRESS + byStatus.RESOLVED;
  const durations = verifiedHistories.map(
    (history) => history.createdAt.getTime() - history.report.createdAt.getTime()
  );
  const followUpEligible = Number(followUpCoverage[0]?.eligible ?? 0n);
  const followUpCovered = Number(followUpCoverage[0]?.covered ?? 0n);
  const resolvedCount = Number(resolvedEvidence[0]?.resolved ?? 0n);
  const resolvedWithProof = Number(resolvedEvidence[0]?.withProof ?? 0n);

  sendData(response, {
    total,
    submissions: total,
    byStatus,
    statusDistribution: percentagesByStatus(byStatus, total),
    verificationRate: percentage(verifiedCount, total),
    followUpCoverage: percentage(followUpCovered, followUpEligible),
    averageTimeToVerifiedMs: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : 0,
    resolvedWithProofRate: percentage(resolvedWithProof, resolvedCount),
    asOf: new Date().toISOString()
  });
});

export default statsRoutes;

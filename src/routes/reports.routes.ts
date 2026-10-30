import { Router } from "express";
import multer from "multer";
import { env } from "../config/env";
import * as reportController from "../controllers/report.controller";
import { requireAuth, requireCsrf, requireRole } from "../middlewares/auth";
import { HttpError } from "../utils/http-error";

const reportsRoutes = Router();
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

function checkUploadRequestSize(request: import("express").Request): void {
  const length = Number(request.get("Content-Length") ?? 0);
  if (length > env.maxUploadRequestBytes) {
    throw new HttpError(422, "VALIDATION_ERROR", "Data tidak valid", {
      request: "Ukuran permintaan melebihi batas"
    });
  }
}

function uploadMiddleware(request: import("express").Request, response: import("express").Response, next: import("express").NextFunction): void {
  checkUploadRequestSize(request);
  upload.array("photos", 3)(request, response, next);
}

reportsRoutes.get("/categories", reportController.listCategories);
reportsRoutes.get("/reports", reportController.listPublicReports);
reportsRoutes.get("/reports/:code", reportController.getPublicReport);

reportsRoutes.post(
  "/reports",
  requireAuth,
  requireRole("PELAPOR"),
  requireCsrf,
  uploadMiddleware,
  reportController.createReport
);
reportsRoutes.get("/me/reports", requireAuth, requireRole("PELAPOR"), reportController.listMyReports);
reportsRoutes.get("/me/reports/:code", requireAuth, requireRole("PELAPOR"), reportController.getMyReport);

reportsRoutes.get("/admin/reports", requireAuth, requireRole("ADMIN"), reportController.listAdminReports);
reportsRoutes.get("/admin/reports/:code", requireAuth, requireRole("ADMIN"), reportController.getAdminReport);
reportsRoutes.post(
  "/admin/reports/:code/follow-ups",
  requireAuth,
  requireRole("ADMIN"),
  requireCsrf,
  uploadMiddleware,
  reportController.addFollowUp
);
reportsRoutes.post(
  "/admin/reports/:code/status",
  requireAuth,
  requireRole("ADMIN"),
  requireCsrf,
  reportController.changeReportStatus
);

export default reportsRoutes;

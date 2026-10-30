import type { Request, RequestHandler } from "express";
import { z } from "zod";
import * as reportService from "../services/report.service";
import { sendData, sendList } from "../utils/responses";
import { listMeta, pagination, parseBody, parseQuery } from "../utils/validation";

const statusSchema = z.enum(["SUBMITTED", "VERIFIED", "IN_PROGRESS", "RESOLVED", "REJECTED", "DUPLICATE"]);
const publicStatusSchema = z.enum(reportService.publicStatusValues);

const publicReportFiltersSchema = z.object({
  category: z.string().trim().min(1).optional(),
  status: publicStatusSchema.optional(),
  district: z.string().trim().min(1).optional(),
  village: z.string().trim().min(1).optional()
});

const ownerReportFiltersSchema = z.object({
  status: statusSchema.optional()
});

const adminReportFiltersSchema = z.object({
  status: statusSchema.optional(),
  category: z.string().trim().min(1).optional()
});

const createReportSchema = z.object({
  categoryId: z.coerce.number().int().positive(),
  title: z.string().trim().min(10, "Judul minimal 10 karakter").max(100, "Judul maksimal 100 karakter"),
  description: z.string().trim().min(30, "Deskripsi minimal 30 karakter").max(1000, "Deskripsi maksimal 1000 karakter"),
  city: z.string().trim().min(1, "Kota wajib diisi").max(100),
  district: z.string().trim().min(1, "Kecamatan wajib diisi").max(100),
  village: z.string().trim().min(1, "Kelurahan wajib diisi").max(100),
  locationDetail: z.string().trim().min(5, "Patokan minimal 5 karakter").max(200),
  submissionKey: z.uuid("submissionKey harus UUID")
});

const followUpSchema = z.object({
  note: z.string().trim().min(10, "Catatan minimal 10 karakter").max(500, "Catatan maksimal 500 karakter"),
  isResolutionNote: z.preprocess(
    (value) => value === "true" ? true : value === "false" ? false : value,
    z.boolean()
  ),
  resolutionExplanation: z.string().trim().max(500, "Penjelasan maksimal 500 karakter").optional()
});

const statusChangeSchema = z.object({
  toStatus: statusSchema,
  expectedStatus: statusSchema,
  reason: z.string().trim().optional()
});

function getCode(request: Request): string {
  return reportService.assertReportCode(request.params.code);
}

function uploadedFiles(request: Request): Express.Multer.File[] {
  return (request.files as Express.Multer.File[] | undefined) ?? [];
}

export const listCategories: RequestHandler = async (_request, response) => {
  sendData(response, await reportService.listCategories());
};

export const listPublicReports: RequestHandler = async (request, response) => {
  const { page, limit } = pagination(request);
  const filters = parseQuery(publicReportFiltersSchema, request.query);
  const result = await reportService.listPublicReports(page, limit, filters);
  sendList(response, result.data, listMeta(page, limit, result.total));
};

export const getPublicReport: RequestHandler = async (request, response) => {
  sendData(response, await reportService.getPublicReport(getCode(request)));
};

export const createReport: RequestHandler = async (request, response) => {
  const body = parseBody(createReportSchema, request.body);
  const result = await reportService.createReport(request.user!.id, body, uploadedFiles(request));
  sendData(response, { code: result.code, status: result.status }, result.created ? 201 : 200);
};

export const listMyReports: RequestHandler = async (request, response) => {
  const { page, limit } = pagination(request);
  const filters = parseQuery(ownerReportFiltersSchema, request.query);
  const result = await reportService.listOwnerReports(request.user!.id, page, limit, filters.status);
  sendList(response, result.data, listMeta(page, limit, result.total), result.counts);
};

export const getMyReport: RequestHandler = async (request, response) => {
  sendData(response, await reportService.getOwnerReport(request.user!.id, getCode(request)));
};

export const listAdminReports: RequestHandler = async (request, response) => {
  const { page, limit } = pagination(request);
  const filters = parseQuery(adminReportFiltersSchema, request.query);
  const result = await reportService.listAdminReports(page, limit, filters);
  sendList(response, result.data, listMeta(page, limit, result.total), result.counts);
};

export const getAdminReport: RequestHandler = async (request, response) => {
  sendData(response, await reportService.getAdminReport(getCode(request)));
};

export const addFollowUp: RequestHandler = async (request, response) => {
  const body = parseBody(followUpSchema, request.body);
  const followUp = await reportService.addFollowUp(
    request.user!.id,
    getCode(request),
    body,
    uploadedFiles(request)
  );
  sendData(response, {
    id: followUp.id,
    note: followUp.note,
    createdAt: followUp.createdAt.toISOString()
  }, 201);
};

export const changeReportStatus: RequestHandler = async (request, response) => {
  const body = parseBody(statusChangeSchema, request.body);
  sendData(
    response,
    await reportService.changeReportStatus(request.user!.id, getCode(request), body)
  );
};

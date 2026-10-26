import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { mediaUrl } from "../src/utils/media-signature";

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();
  const model = (methods: string[]) => Object.fromEntries(methods.map((method) => [method, fn()]));
  return {
    prisma: {
      session: model(["create", "findUnique", "deleteMany"]),
      user: model(["create", "findUnique", "update"]),
      reportCategory: model(["findMany", "findFirst"]),
      report: model(["count", "create", "createMany", "findFirst", "findUnique", "findMany", "updateMany"]),
      reportStatusHistory: model(["create", "findMany"]),
      reportFollowUp: model(["create", "findFirst", "findMany"]),
      reportEvidence: model(["create", "createMany", "findUnique", "findMany"]),
      $transaction: fn(),
      $queryRaw: fn(),
      $executeRaw: fn()
    }
  };
});

vi.mock("../src/db", () => ({ prisma: mocks.prisma }));
vi.mock("argon2", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("argon2-hash"),
    verify: vi.fn().mockResolvedValue(true)
  }
}));

import app from "../src/app";

const frontend = "http://localhost:5173";
const csrfToken = "test-csrf-token";
const csrfHash = createHash("sha256").update(csrfToken).digest("hex");
const user = {
  id: "c9a0c234-cbc6-4593-b9ed-f7bf8a400001",
  name: "Rani",
  role: "PELAPOR",
  accountStatus: "ACTIVE",
  deletedAt: null,
  passwordHash: "argon2-hash"
};

function sessionCookie(role: string = "PELAPOR"): string {
  mocks.prisma.session.findUnique.mockResolvedValue({
    id: "session-id",
    expiresAt: new Date(Date.now() + 60_000),
    csrfHash,
    user: { ...user, role }
  });
  return "laporinaja_session=session-token; laporinaja_csrf=" + csrfToken;
}

function mutationHeaders(role?: string) {
  return {
    Origin: frontend,
    Cookie: sessionCookie(role),
    "X-CSRF-Token": csrfToken
  };
}

const reportData = {
  id: "91ab27ae-4f1c-4e31-87c9-f9ac11d1f6a2",
  publicCode: "LPR-2026-000001",
  reporterId: user.id,
  categoryId: 1,
  title: "Lampu jalan mati di depan sekolah",
  description: "Lampu jalan di depan sekolah sudah mati sejak beberapa malam lalu.",
  city: "Kota",
  district: "Kecamatan",
  village: "Kelurahan",
  locationDetail: "Dekat gerbang sekolah",
  status: "IN_PROGRESS",
  isHidden: false,
  createdAt: new Date("2026-10-26T00:00:00.000Z"),
  category: { id: 1, name: "Lampu jalan", slug: "lampu-jalan" },
  evidences: [],
  statusHistories: [],
  followUps: []
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(async (operations: unknown) => {
    if (typeof operations === "function") {
      return (operations as (tx: typeof mocks.prisma) => unknown)(mocks.prisma);
    }
    if (Array.isArray(operations)) return Promise.all(operations);
    return operations;
  });
});

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await rm("test-uploads", { recursive: true, force: true });
});

describe("API contract transport and authentication", () => {
  it("exposes the server health endpoint", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("uses the standard envelope for an unknown endpoint", async () => {
    const response = await request(app).get("/api/unknown").set("Origin", frontend);
    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: "NOT_FOUND",
      message: "Endpoint tidak ditemukan"
    });
  });

  it("allows credentialed CORS only for the configured frontend", async () => {
    const allowed = await request(app)
      .options("/api/auth/login")
      .set("Origin", frontend)
      .set("Access-Control-Request-Method", "POST");
    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(frontend);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const blocked = await request(app).get("/api/categories").set("Origin", "https://attacker.example");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("ORIGIN_FORBIDDEN");
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects browser mutations without an allowed Origin", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Rani",
      email: "rani@example.test",
      password: "password123"
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ORIGIN_FORBIDDEN");
  });

  it("uses the standard field validation error envelope", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .set("Origin", frontend)
      .send({ name: "A", email: "not-an-email", password: "short", role: "ADMIN" });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Data tidak valid"
    });
    expect(response.body.error.fields).toHaveProperty("name");
    expect(response.body.error.fields).toHaveProperty("email");
    expect(response.body.error.fields).toHaveProperty("password");
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it("registers only PELAPOR accounts and maps duplicate email to 409", async () => {
    mocks.prisma.user.create.mockResolvedValue({ id: user.id, name: "Rani", role: "PELAPOR" });
    const created = await request(app)
      .post("/api/auth/register")
      .set("Origin", frontend)
      .send({ name: "Rani", email: "RANI@EXAMPLE.TEST", password: "password123", role: "ADMIN" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { id: user.id, name: "Rani", role: "PELAPOR" } });
    expect(mocks.prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "rani@example.test", role: "PELAPOR" })
    }));

    mocks.prisma.user.create.mockRejectedValue({ code: "P2002" });
    const duplicate = await request(app)
      .post("/api/auth/register")
      .set("Origin", frontend)
      .send({ name: "Rani", email: "rani@example.test", password: "password123" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("sets an HttpOnly Lax session cookie, hides login failures and logs out with CSRF", async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    const invalid = await request(app)
      .post("/api/auth/login")
      .set("Origin", frontend)
      .send({ email: "rani@example.test", password: "password123" });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error.message).toBe("Email atau password salah");

    mocks.prisma.session.create.mockResolvedValue({});
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", frontend)
      .send({ email: "RANI@example.test", password: "password123" });
    expect(login.status).toBe(200);
    expect(login.body.data).toEqual({ id: user.id, name: user.name, role: user.role });
    const cookies = login.headers["set-cookie"] as string[];
    expect(cookies.some((cookie) => cookie.includes("laporinaja_session=") &&
      cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax"))).toBe(true);
    expect(cookies.some((cookie) => cookie.includes("laporinaja_csrf="))).toBe(true);

    const missingCsrf = await request(app)
      .post("/api/auth/logout")
      .set("Origin", frontend)
      .set("Cookie", sessionCookie());
    expect(missingCsrf.status).toBe(403);

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Origin", frontend)
      .set("Cookie", sessionCookie())
      .set("X-CSRF-Token", csrfToken);
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ data: { ok: true } });
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalled();
    const clearedCookies = logout.headers["set-cookie"] as string[];
    expect(clearedCookies.some((cookie) => cookie.includes("laporinaja_session=;") &&
      /Expires=Thu, 01 Jan 1970/i.test(cookie))).toBe(true);
  });

  it("returns 401 without a session and 403 for a role mismatch", async () => {
    mocks.prisma.session.findUnique.mockResolvedValue(null);
    const unauthorized = await request(app).get("/api/me/reports").set("Origin", frontend);
    expect(unauthorized.status).toBe(401);

    const forbidden = await request(app)
      .get("/api/me/reports")
      .set("Origin", frontend)
      .set("Cookie", sessionCookie("ADMIN"));
    expect(forbidden.status).toBe(403);
  });

  it("rejects suspended sessions on every protected request", async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: "session-id",
      expiresAt: new Date(Date.now() + 60_000),
      csrfHash,
      user: { ...user, accountStatus: "SUSPENDED" }
    });
    const response = await request(app)
      .get("/api/auth/me")
      .set("Origin", frontend)
      .set("Cookie", "laporinaja_session=session-token");
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ACCOUNT_FORBIDDEN");
  });
});

describe("report and privacy contract", () => {
  it("returns a uniform 404 for a report code not owned by the pelapor", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .get("/api/me/reports/LPR-2026-000099")
      .set("Origin", frontend)
      .set("Cookie", sessionCookie("PELAPOR"));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(mocks.prisma.report.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { publicCode: "LPR-2026-000099", reporterId: user.id }
    }));
  });

  it("does not expose reporter identity or private rejection reasons publicly", async () => {
    mocks.prisma.report.findFirst.mockResolvedValue({
      ...reportData,
      status: "VERIFIED",
      statusHistories: [
        { fromStatus: null, toStatus: "SUBMITTED", createdAt: new Date(), reason: null },
        { fromStatus: "SUBMITTED", toStatus: "REJECTED", createdAt: new Date(), reason: "private reason" },
        { fromStatus: "REJECTED", toStatus: "SUBMITTED", createdAt: new Date(), reason: "private correction" },
        { fromStatus: "SUBMITTED", toStatus: "VERIFIED", createdAt: new Date(), reason: null }
      ],
      reporter: { name: "Rani", email: "private@example.test" }
    });
    const response = await request(app)
      .get("/api/reports/LPR-2026-000001")
      .set("Origin", frontend);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(user.id);
    expect(JSON.stringify(response.body)).not.toContain("private@example.test");
    expect(JSON.stringify(response.body)).not.toContain("private reason");
    expect(response.body.data.timeline).toHaveLength(2);
    expect(response.body.data.timeline[0].actorLabel).toBe("Administrator platform");
  });

  it("serves signed evidence only when the report is public or the viewer is authorized", async () => {
    const id = "223c0918-5f83-4a78-88da-110d04478f44";
    const key = "signed-photo.png";
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ffffff" }
    }).png().toBuffer();
    await mkdir("test-uploads", { recursive: true });
    await writeFile(path.join("test-uploads", key), image);
    const signedUrl = mediaUrl(id);
    mocks.prisma.reportEvidence.findUnique.mockResolvedValue({
      id,
      storageKey: key,
      mimeType: "image/png",
      report: { reporterId: user.id, status: "SUBMITTED", isHidden: false }
    });
    const privateFile = await request(app).get(signedUrl).set("Origin", frontend);
    expect(privateFile.status).toBe(404);
    expect(privateFile.body.error.code).toBe("NOT_FOUND");

    mocks.prisma.reportEvidence.findUnique.mockResolvedValue({
      id,
      storageKey: key,
      mimeType: "image/png",
      report: { reporterId: user.id, status: "VERIFIED", isHidden: false }
    });
    const publicFile = await request(app).get(signedUrl).set("Origin", frontend);
    expect(publicFile.status).toBe(200);
    expect(publicFile.headers["content-type"]).toContain("image/png");
  });

  it("enforces expectedStatus conflicts and invalid transitions", async () => {
    mocks.prisma.report.findUnique.mockResolvedValue({ id: reportData.id, status: "IN_PROGRESS" });
    const conflict = await request(app)
      .post("/api/admin/reports/LPR-2026-000001/status")
      .set(mutationHeaders("ADMIN"))
      .send({ toStatus: "VERIFIED", expectedStatus: "SUBMITTED" });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("STATUS_CONFLICT");

    const invalid = await request(app)
      .post("/api/admin/reports/LPR-2026-000001/status")
      .set(mutationHeaders("ADMIN"))
      .send({ toStatus: "SUBMITTED", expectedStatus: "IN_PROGRESS" });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe("INVALID_TRANSITION");
    expect(mocks.prisma.report.updateMany).not.toHaveBeenCalled();
  });

  it("returns the same 200 result for a retried submissionKey", async () => {
    mocks.prisma.report.findUnique.mockResolvedValue({
      publicCode: "LPR-2026-000021",
      status: "SUBMITTED"
    });
    const response = await request(app)
      .post("/api/reports")
      .set(mutationHeaders("PELAPOR"))
      .field("categoryId", "1")
      .field("title", "Lampu jalan mati dekat taman")
      .field("description", "Lampu jalan di dekat taman tidak menyala selama tiga malam.")
      .field("city", "Kota")
      .field("district", "Kecamatan")
      .field("village", "Kelurahan")
      .field("locationDetail", "Dekat taman utama")
      .field("submissionKey", "7f3e2cee-c90c-4a54-b12a-5a9c65a13590")
      .attach("photos", Buffer.from("not inspected because idempotency key already exists"), {
        filename: "photo.png",
        contentType: "image/png"
      });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ code: "LPR-2026-000021", status: "SUBMITTED" });
    expect(mocks.prisma.report.create).not.toHaveBeenCalled();
  });

  it("creates a report, initial history, and image metadata as one database transaction", async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ffffff" }
    }).png().toBuffer();
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportCategory.findFirst.mockResolvedValue({ id: 1 });
    mocks.prisma.report.count.mockResolvedValue(0);
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ value: 21n }]);
    mocks.prisma.report.create.mockResolvedValue({
      id: reportData.id,
      publicCode: "LPR-2026-000021",
      status: "SUBMITTED"
    });
    mocks.prisma.reportStatusHistory.create.mockResolvedValue({ id: "history-id" });
    mocks.prisma.reportEvidence.createMany.mockResolvedValue({ count: 1 });

    const response = await request(app)
      .post("/api/reports")
      .set(mutationHeaders("PELAPOR"))
      .field("categoryId", "1")
      .field("title", "Lampu jalan mati dekat taman")
      .field("description", "Lampu jalan di dekat taman tidak menyala selama tiga malam.")
      .field("city", "Kota")
      .field("district", "Kecamatan")
      .field("village", "Kelurahan")
      .field("locationDetail", "Dekat taman utama")
      .field("submissionKey", "7f3e2cee-c90c-4a54-b12a-5a9c65a13590")
      .attach("photos", png, { filename: "photo.png", contentType: "image/png" });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ code: "LPR-2026-000021", status: "SUBMITTED" });
    expect(mocks.prisma.reportStatusHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        fromStatus: null,
        toStatus: "SUBMITTED",
        changedBy: user.id
      })
    }));
    expect(mocks.prisma.reportEvidence.createMany).toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalled();
  });

  it("rejects invalid image bytes before inserting a report", async () => {
    mocks.prisma.report.findUnique.mockResolvedValue(null);
    mocks.prisma.reportCategory.findFirst.mockResolvedValue({ id: 1 });
    mocks.prisma.report.count.mockResolvedValue(0);
    const response = await request(app)
      .post("/api/reports")
      .set(mutationHeaders("PELAPOR"))
      .field("categoryId", "1")
      .field("title", "Lampu jalan mati dekat taman")
      .field("description", "Lampu jalan di dekat taman tidak menyala selama tiga malam.")
      .field("city", "Kota")
      .field("district", "Kecamatan")
      .field("village", "Kelurahan")
      .field("locationDetail", "Dekat taman utama")
      .field("submissionKey", "7f3e2cee-c90c-4a54-b12a-5a9c65a13590")
      .attach("photos", Buffer.from("not an image"), { filename: "photo.png", contentType: "image/png" });
    expect(response.status).toBe(422);
    expect(response.body.error.fields.photos).toBeDefined();
    expect(mocks.prisma.report.create).not.toHaveBeenCalled();
  });

  it("requires a visual proof or a 30-character resolution explanation", async () => {
    const response = await request(app)
      .post("/api/admin/reports/LPR-2026-000001/follow-ups")
      .set(mutationHeaders("ADMIN"))
      .field("note", "Pekerjaan perbaikan sudah selesai")
      .field("isResolutionNote", "true");
    expect(response.status).toBe(422);
    expect(response.body.error.fields.resolutionExplanation).toBeDefined();
    expect(mocks.prisma.reportFollowUp.create).not.toHaveBeenCalled();
  });

  it("returns public statistics with enum counts and a zero-safe completion percentage", async () => {
    mocks.prisma.report.count.mockResolvedValue(0);
    mocks.prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const response = await request(app).get("/api/stats/public").set("Origin", frontend);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      total: 0,
      byStatus: {
        SUBMITTED: 0, VERIFIED: 0, IN_PROGRESS: 0,
        RESOLVED: 0, REJECTED: 0, DUPLICATE: 0
      },
      completionRate: 0,
      label: "Data demonstrasi"
    });
    expect(response.body.data.asOf).toMatch(/Z$/);
  });

  it("calculates administrator metrics using the PRD denominators", async () => {
    mocks.prisma.report.count.mockResolvedValue(8);
    mocks.prisma.$queryRaw
      .mockResolvedValueOnce([
        { status: "SUBMITTED", count: 2n },
        { status: "VERIFIED", count: 2n },
        { status: "IN_PROGRESS", count: 1n },
        { status: "RESOLVED", count: 1n },
        { status: "REJECTED", count: 1n },
        { status: "DUPLICATE", count: 1n }
      ])
      .mockResolvedValueOnce([{ eligible: 3n, covered: 2n }])
      .mockResolvedValueOnce([{ resolved: 1n, withProof: 1n }]);
    mocks.prisma.reportStatusHistory.findMany.mockResolvedValue([{
      reportId: reportData.id,
      createdAt: new Date("2026-10-26T00:00:10.000Z"),
      report: { createdAt: new Date("2026-10-26T00:00:00.000Z") }
    }]);

    const response = await request(app)
      .get("/api/admin/stats")
      .set("Origin", frontend)
      .set("Cookie", sessionCookie("ADMIN"));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      total: 8,
      submissions: 8,
      verificationRate: 50,
      followUpCoverage: 66.67,
      averageTimeToVerifiedMs: 10_000,
      resolvedWithProofRate: 100
    });
    expect(response.body.data.byStatus.DUPLICATE).toBe(1);
  });

  it.each([
    ["with photo evidence", true],
    ["with a text explanation", false]
  ])("supports resolving a report %s", async (_label, withPhoto) => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#ffffff" }
    }).png().toBuffer();
    mocks.prisma.report.findUnique.mockResolvedValue({
      id: reportData.id,
      status: "IN_PROGRESS"
    });
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ status: "IN_PROGRESS" }]);
    mocks.prisma.reportFollowUp.create.mockResolvedValue({
      id: "5ea3cd77-8123-4702-94ea-1f8a1e480ad1",
      note: "Perbaikan telah selesai dilakukan",
      isResolutionNote: true,
      resolutionExplanation: withPhoto ? null : "Petugas mengganti lampu dan menguji nyala kembali.",
      createdAt: new Date("2026-10-26T00:00:00.000Z")
    });
    mocks.prisma.reportEvidence.createMany.mockResolvedValue({ count: withPhoto ? 1 : 0 });

    let followUpRequest = request(app)
      .post("/api/admin/reports/LPR-2026-000001/follow-ups")
      .set(mutationHeaders("ADMIN"))
      .field("note", "Perbaikan telah selesai dilakukan")
      .field("isResolutionNote", "true");
    if (withPhoto) {
      followUpRequest = followUpRequest.attach("photos", png, {
        filename: "proof.png",
        contentType: "image/png"
      });
    } else {
      followUpRequest = followUpRequest.field(
        "resolutionExplanation",
        "Petugas mengganti lampu dan menguji nyala kembali."
      );
    }
    const followUp = await followUpRequest;
    expect(followUp.status).toBe(201);
    expect(followUp.body.data).toEqual({
      id: "5ea3cd77-8123-4702-94ea-1f8a1e480ad1",
      note: "Perbaikan telah selesai dilakukan",
      createdAt: "2026-10-26T00:00:00.000Z"
    });

    mocks.prisma.reportFollowUp.findFirst.mockResolvedValue({
      id: "5ea3cd77-8123-4702-94ea-1f8a1e480ad1",
      resolutionExplanation: withPhoto ? null : "Petugas mengganti lampu dan menguji nyala kembali.",
      evidences: withPhoto ? [{ id: "evidence-id" }] : []
    });
    mocks.prisma.$queryRaw.mockResolvedValueOnce([{ status: "IN_PROGRESS" }]);
    mocks.prisma.report.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.reportStatusHistory.create.mockResolvedValue({ id: "history-id" });
    const resolved = await request(app)
      .post("/api/admin/reports/LPR-2026-000001/status")
      .set(mutationHeaders("ADMIN"))
      .send({ toStatus: "RESOLVED", expectedStatus: "IN_PROGRESS" });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toEqual({
      code: "LPR-2026-000001",
      status: "RESOLVED",
      historyId: "history-id"
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalled();
  });

  it("rate-limits repeated login attempts with a contract error envelope", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    const responses = await Promise.all(Array.from({ length: 12 }, () =>
      request(app)
        .post("/api/auth/login")
        .set("Origin", frontend)
        .send({ email: "nobody@example.test", password: "password123" })
    ));
    const limited = responses.find((response) => response.status === 429);
    expect(limited).toBeDefined();
    expect(limited?.body.error.code).toBe("RATE_LIMITED");
  });
});

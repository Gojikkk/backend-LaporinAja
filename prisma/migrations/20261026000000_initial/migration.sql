CREATE TYPE "user_role" AS ENUM ('PELAPOR', 'ADMIN');
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "report_status" AS ENUM ('SUBMITTED', 'VERIFIED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'DUPLICATE');
CREATE TYPE "evidence_kind" AS ENUM ('REPORT_PHOTO', 'RESOLUTION_PROOF');

CREATE SEQUENCE "report_public_code_seq" START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'PELAPOR',
    "account_status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "report_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "public_code" VARCHAR(20) NOT NULL,
    "reporter_id" UUID NOT NULL,
    "category_id" INTEGER NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "village" VARCHAR(100) NOT NULL,
    "location_detail" VARCHAR(200) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status" "report_status" NOT NULL DEFAULT 'SUBMITTED',
    "duplicate_of_report_id" UUID,
    "submission_key" VARCHAR(64),
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_status_histories" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "from_status" "report_status",
    "to_status" "report_status" NOT NULL,
    "changed_by" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_status_histories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_follow_ups" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "is_resolution_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "report_evidences" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "follow_up_id" UUID,
    "uploaded_by" UUID NOT NULL,
    "kind" "evidence_kind" NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(50) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "alt_text" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "report_evidences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "report_categories_name_key" ON "report_categories"("name");
CREATE UNIQUE INDEX "report_categories_slug_key" ON "report_categories"("slug");
CREATE UNIQUE INDEX "reports_public_code_key" ON "reports"("public_code");
CREATE UNIQUE INDEX "reports_reporter_id_submission_key_key" ON "reports"("reporter_id", "submission_key");
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at" DESC);
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at" DESC);
CREATE INDEX "reports_category_id_status_idx" ON "reports"("category_id", "status");
CREATE INDEX "reports_district_village_idx" ON "reports"("district", "village");
CREATE INDEX "report_status_histories_report_id_created_at_idx" ON "report_status_histories"("report_id", "created_at");
CREATE INDEX "report_follow_ups_report_id_created_at_idx" ON "report_follow_ups"("report_id", "created_at");
CREATE INDEX "report_evidences_report_id_created_at_idx" ON "report_evidences"("report_id", "created_at");

ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey"
    FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "report_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_duplicate_of_report_id_fkey"
    FOREIGN KEY ("duplicate_of_report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_status_histories" ADD CONSTRAINT "report_status_histories_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_status_histories" ADD CONSTRAINT "report_status_histories_changed_by_fkey"
    FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_follow_ups" ADD CONSTRAINT "report_follow_ups_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_follow_ups" ADD CONSTRAINT "report_follow_ups_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_evidences" ADD CONSTRAINT "report_evidences_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_evidences" ADD CONSTRAINT "report_evidences_follow_up_id_fkey"
    FOREIGN KEY ("follow_up_id") REFERENCES "report_follow_ups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "report_evidences" ADD CONSTRAINT "report_evidences_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

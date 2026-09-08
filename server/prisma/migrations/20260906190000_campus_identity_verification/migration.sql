CREATE TYPE "CampusIdentityVerificationStatus" AS ENUM ('pending', 'approved', 'rejected', 'revoked');

ALTER TABLE "login_logs" RENAME COLUMN "email" TO "identifier";
ALTER INDEX "login_logs_email_created_at_idx" RENAME TO "login_logs_identifier_created_at_idx";

CREATE TABLE "campus_identity_verifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "real_name_encrypted" TEXT NOT NULL,
  "id_number_encrypted" TEXT NOT NULL,
  "id_number_fingerprint" TEXT NOT NULL,
  "id_number_last4" TEXT NOT NULL,
  "class_name" TEXT NOT NULL,
  "student_no" TEXT NOT NULL,
  "status" "CampusIdentityVerificationStatus" NOT NULL DEFAULT 'pending',
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  "review_reason" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "campus_identity_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campus_identity_verifications_user_id_key" ON "campus_identity_verifications"("user_id");
CREATE INDEX "campus_identity_verifications_status_submitted_at_idx" ON "campus_identity_verifications"("status", "submitted_at");
CREATE INDEX "campus_identity_verifications_id_number_fingerprint_idx" ON "campus_identity_verifications"("id_number_fingerprint");
CREATE INDEX "campus_identity_verifications_student_no_status_idx" ON "campus_identity_verifications"("student_no", "status");
CREATE INDEX "campus_identity_verifications_reviewed_at_idx" ON "campus_identity_verifications"("reviewed_at");
CREATE UNIQUE INDEX "campus_identity_verifications_active_id_number_key"
  ON "campus_identity_verifications"("id_number_fingerprint")
  WHERE "status" IN ('pending', 'approved');
CREATE UNIQUE INDEX "campus_identity_verifications_active_student_no_key"
  ON "campus_identity_verifications"(lower("student_no"))
  WHERE "status" IN ('pending', 'approved');

ALTER TABLE "campus_identity_verifications"
  ADD CONSTRAINT "campus_identity_verifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "campus_identity_verifications"
  ADD CONSTRAINT "campus_identity_verifications_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

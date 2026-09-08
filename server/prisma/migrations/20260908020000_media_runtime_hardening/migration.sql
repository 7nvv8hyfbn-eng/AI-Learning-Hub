CREATE TABLE "storage_reservations" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "storage_driver" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('image', 'document', 'video', 'processing')),
  "state" TEXT NOT NULL DEFAULT 'uploading' CHECK ("state" IN ('uploading', 'queued', 'processing', 'released')),
  "source_limit" BIGINT NOT NULL CHECK ("source_limit" > 0),
  "playable_limit" BIGINT NOT NULL DEFAULT 0 CHECK ("playable_limit" >= 0),
  "remaining_bytes" BIGINT NOT NULL CHECK ("remaining_bytes" >= 0),
  "temporary_bytes" BIGINT NOT NULL CHECK ("temporary_bytes" >= 0),
  "claim_token" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "storage_reservations_storage_driver_state_expires_at_idx" ON "storage_reservations"("storage_driver", "state", "expires_at");
CREATE INDEX "storage_reservations_user_id_state_idx" ON "storage_reservations"("user_id", "state");

ALTER TABLE "files"
  ADD COLUMN "reservation_id" TEXT REFERENCES "storage_reservations"("id") ON DELETE SET NULL,
  ADD COLUMN "scan_status" TEXT NOT NULL DEFAULT 'not_scanned' CHECK ("scan_status" IN ('not_scanned', 'clean', 'unavailable', 'infected', 'error')),
  ADD COLUMN "scan_message" TEXT,
  ADD COLUMN "scanned_at" TIMESTAMP(3),
  ADD COLUMN "quarantined_at" TIMESTAMP(3);
CREATE INDEX "files_uploaded_by_storage_driver_idx" ON "files"("uploaded_by", "storage_driver");
CREATE INDEX "files_reservation_id_idx" ON "files"("reservation_id");
CREATE INDEX "files_quarantined_at_idx" ON "files"("quarantined_at");

ALTER TABLE "video_assets"
  ADD COLUMN "claim_token" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "reservation_id" TEXT REFERENCES "storage_reservations"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "video_assets_reservation_id_key" ON "video_assets"("reservation_id");
CREATE INDEX "video_assets_status_lease_expires_at_idx" ON "video_assets"("status", "lease_expires_at");

ALTER TABLE "media_gc_jobs" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "last_error" TEXT, ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

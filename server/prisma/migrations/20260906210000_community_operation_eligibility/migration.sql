CREATE TABLE "community_operation_restrictions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "operations" TEXT[] NOT NULL,
  "reason" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoked_by_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "community_operation_restrictions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "community_operation_restrictions_window_check" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "community_operation_restrictions_operations_check" CHECK (cardinality("operations") > 0)
);

CREATE INDEX "community_operation_restrictions_user_id_revoked_at_ends_at_idx"
  ON "community_operation_restrictions"("user_id", "revoked_at", "ends_at");
CREATE INDEX "community_operation_restrictions_ends_at_idx"
  ON "community_operation_restrictions"("ends_at");

ALTER TABLE "community_operation_restrictions"
  ADD CONSTRAINT "community_operation_restrictions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_operation_restrictions"
  ADD CONSTRAINT "community_operation_restrictions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_operation_restrictions"
  ADD CONSTRAINT "community_operation_restrictions_revoked_by_id_fkey"
  FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

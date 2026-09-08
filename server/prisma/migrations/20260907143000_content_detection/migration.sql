ALTER TYPE "CommunityPostStatus" ADD VALUE 'pending_review';
ALTER TABLE "learning_collections" ADD COLUMN "content_status" TEXT NOT NULL DEFAULT 'published' CHECK ("content_status" IN ('published', 'pending_review'));

CREATE TABLE "content_reviews" (
  "id" TEXT PRIMARY KEY,
  "target_type" TEXT NOT NULL CHECK ("target_type" IN ('post', 'comment', 'profile', 'collection', 'resource')),
  "target_id" TEXT NOT NULL,
  "content_revision" INTEGER NOT NULL CHECK ("content_revision" > 0),
  "rule_version" INTEGER NOT NULL CHECK ("rule_version" > 0),
  "author_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "submitted_by_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" TEXT NOT NULL CHECK ("action" IN ('allow', 'warn', 'review', 'reject')),
  "status" TEXT NOT NULL CHECK ("status" IN ('not_required', 'pending', 'approved', 'rejected', 'superseded')),
  "findings" JSONB NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "reviewed_by_id" TEXT REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reason" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),
  CONSTRAINT "content_reviews_target_type_target_id_content_revision_key" UNIQUE ("target_type", "target_id", "content_revision")
);
CREATE INDEX "content_reviews_status_created_at_id_idx" ON "content_reviews"("status", "created_at", "id");
CREATE INDEX "content_reviews_author_id_created_at_idx" ON "content_reviews"("author_id", "created_at");

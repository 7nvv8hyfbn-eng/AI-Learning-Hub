CREATE TYPE "ResourceContributionKind" AS ENUM ('video', 'article', 'document');
CREATE TYPE "VideoProcessingStatus" AS ENUM ('uploaded', 'processing', 'ready', 'failed');
CREATE TYPE "LearningCollectionVisibility" AS ENUM ('private', 'community');

ALTER TABLE "resource_categories"
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'resource',
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "video_assets" (
  "id" TEXT NOT NULL,
  "uploader_id" TEXT NOT NULL,
  "source_file_id" TEXT NOT NULL,
  "playable_file_id" TEXT,
  "poster_file_id" TEXT,
  "status" "VideoProcessingStatus" NOT NULL DEFAULT 'uploaded',
  "original_name" TEXT NOT NULL,
  "original_mime_type" TEXT NOT NULL,
  "duration_seconds" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "rotation" INTEGER NOT NULL DEFAULT 0,
  "video_codec" TEXT,
  "audio_codec" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "claimed_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "last_error" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_assets_source_file_id_key" ON "video_assets"("source_file_id");
CREATE UNIQUE INDEX "video_assets_playable_file_id_key" ON "video_assets"("playable_file_id");
CREATE UNIQUE INDEX "video_assets_poster_file_id_key" ON "video_assets"("poster_file_id");
CREATE INDEX "video_assets_status_claimed_at_created_at_idx" ON "video_assets"("status", "claimed_at", "created_at");
CREATE INDEX "video_assets_uploader_id_created_at_idx" ON "video_assets"("uploader_id", "created_at");

CREATE TABLE "resource_contributions" (
  "post_id" TEXT NOT NULL,
  "kind" "ResourceContributionKind" NOT NULL,
  "category_id" TEXT,
  "video_asset_id" TEXT,
  "attachment_file_id" TEXT,
  "cover_file_id" TEXT,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "teaching_reuse_consent" BOOLEAN NOT NULL DEFAULT false,
  "source_name" TEXT,
  "source_url" TEXT,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "live_replay" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "resource_contributions_pkey" PRIMARY KEY ("post_id")
);

CREATE UNIQUE INDEX "resource_contributions_video_asset_id_key" ON "resource_contributions"("video_asset_id");
CREATE INDEX "resource_contributions_kind_category_id_featured_updated_at_idx" ON "resource_contributions"("kind", "category_id", "featured", "updated_at");
CREATE INDEX "resource_contributions_category_id_updated_at_idx" ON "resource_contributions"("category_id", "updated_at");

CREATE TABLE "learning_collections" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "learning_goal" TEXT NOT NULL DEFAULT '',
  "visibility" "LearningCollectionVisibility" NOT NULL DEFAULT 'private',
  "system_kind" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_collections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "learning_collections_owner_id_system_kind_key" ON "learning_collections"("owner_id", "system_kind");
CREATE INDEX "learning_collections_visibility_updated_at_idx" ON "learning_collections"("visibility", "updated_at");

CREATE TABLE "learning_collection_items" (
  "id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "contribution_post_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "learning_collection_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "learning_collection_items_collection_id_contribution_post_id_key" ON "learning_collection_items"("collection_id", "contribution_post_id");
CREATE INDEX "learning_collection_items_collection_id_sort_order_id_idx" ON "learning_collection_items"("collection_id", "sort_order", "id");

CREATE TABLE "resource_watch_progress" (
  "user_id" TEXT NOT NULL,
  "video_asset_id" TEXT NOT NULL,
  "position_seconds" INTEGER NOT NULL DEFAULT 0,
  "watched_seconds" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "resource_watch_progress_pkey" PRIMARY KEY ("user_id", "video_asset_id")
);

CREATE INDEX "resource_watch_progress_user_id_updated_at_idx" ON "resource_watch_progress"("user_id", "updated_at");

CREATE TABLE "collection_course_references" (
  "id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "course_version_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "source_revision" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collection_course_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "collection_course_references_collection_id_course_id_key" ON "collection_course_references"("collection_id", "course_id");
CREATE INDEX "collection_course_references_course_id_created_at_idx" ON "collection_course_references"("course_id", "created_at");

ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_playable_file_id_fkey" FOREIGN KEY ("playable_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_poster_file_id_fkey" FOREIGN KEY ("poster_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_contributions" ADD CONSTRAINT "resource_contributions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_contributions" ADD CONSTRAINT "resource_contributions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "resource_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "resource_contributions" ADD CONSTRAINT "resource_contributions_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "video_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_contributions" ADD CONSTRAINT "resource_contributions_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_contributions" ADD CONSTRAINT "resource_contributions_cover_file_id_fkey" FOREIGN KEY ("cover_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_collections" ADD CONSTRAINT "learning_collections_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_collection_items" ADD CONSTRAINT "learning_collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "learning_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_collection_items" ADD CONSTRAINT "learning_collection_items_contribution_post_id_fkey" FOREIGN KEY ("contribution_post_id") REFERENCES "resource_contributions"("post_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resource_watch_progress" ADD CONSTRAINT "resource_watch_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resource_watch_progress" ADD CONSTRAINT "resource_watch_progress_video_asset_id_fkey" FOREIGN KEY ("video_asset_id") REFERENCES "video_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_course_references" ADD CONSTRAINT "collection_course_references_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "learning_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collection_course_references" ADD CONSTRAINT "collection_course_references_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collection_course_references" ADD CONSTRAINT "collection_course_references_course_version_id_fkey" FOREIGN KEY ("course_version_id") REFERENCES "course_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collection_course_references" ADD CONSTRAINT "collection_course_references_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "resource_categories" ("id", "code", "name", "description", "icon", "sort_order", "active", "updated_at")
VALUES
  ('resource-category-ai-foundation', 'ai-foundation', 'AI基础', '人工智能基础知识与入门课程', 'book', 10, true, CURRENT_TIMESTAMP),
  ('resource-category-lab-demo', 'lab-demo', '实训演示', '课堂实训与项目演示', 'lab', 20, true, CURRENT_TIMESTAMP),
  ('resource-category-model-deployment', 'model-deployment', '模型部署', '模型部署、运维与性能优化', 'server', 30, true, CURRENT_TIMESTAMP),
  ('resource-category-agent-practice', 'agent-practice', 'Agent实战', '智能体设计与工作流实践', 'workflow', 40, true, CURRENT_TIMESTAMP),
  ('resource-category-tool-tutorial', 'tool-tutorial', '工具教程', 'AI工具使用与效率方法', 'tool', 50, true, CURRENT_TIMESTAMP),
  ('resource-category-creator-share', 'creator-share', '创作者分享', '师生创作经验与作品展示', 'users', 60, true, CURRENT_TIMESTAMP),
  ('resource-category-uncategorized', 'uncategorized', '其他分享', '尚未归类的学习资源', 'folder', 999, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

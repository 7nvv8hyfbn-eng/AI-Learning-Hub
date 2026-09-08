-- AlterTable
-- 增量迁移：不修改账号、人工配置和原有发布内容。
ALTER TABLE "community_reports" ADD COLUMN     "action_id" TEXT,
ADD COLUMN     "assigned_to_id" TEXT,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "collection_id" TEXT,
ADD COLUMN     "content_revision" INTEGER,
ADD COLUMN     "due_at" TIMESTAMP(3) NOT NULL DEFAULT (now() + '2 days'::interval),
ADD COLUMN     "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profile_id" TEXT,
ADD COLUMN     "result_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "content_reviews" ADD COLUMN     "assigned_to_id" TEXT,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "due_at" TIMESTAMP(3) NOT NULL DEFAULT (now() + '2 days'::interval);

-- AlterTable
ALTER TABLE "community_moderation_actions" ADD COLUMN     "collection_id" TEXT,
ADD COLUMN     "comment_id" TEXT,
ADD COLUMN     "content_revision" INTEGER,
ADD COLUMN     "expires_at" TIMESTAMP(3),
ADD COLUMN     "post_id" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "revoke_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "revoked_at" TIMESTAMP(3),
ADD COLUMN     "revoked_by_id" TEXT,
ADD COLUMN     "rule_code" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "subject_id" TEXT;

-- AlterTable
ALTER TABLE "community_operation_restrictions" ADD COLUMN     "moderation_action_id" TEXT;

-- CreateTable
CREATE TABLE "community_appeals" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "action_id" TEXT,
    "review_id" TEXT,
    "request_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "assigned_to_id" TEXT,
    "claimed_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3) NOT NULL DEFAULT (now() + '2 days'::interval),
    "result_reason" TEXT NOT NULL DEFAULT '',
    "handled_by_id" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_appeals_status_due_at_created_at_idx" ON "community_appeals"("status", "due_at", "created_at");

-- CreateIndex
CREATE INDEX "community_appeals_author_id_created_at_idx" ON "community_appeals"("author_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "community_appeals_author_id_request_hash_key" ON "community_appeals"("author_id", "request_hash");

-- CreateIndex
CREATE INDEX "community_moderation_actions_subject_id_action_revoked_at_e_idx" ON "community_moderation_actions"("subject_id", "action", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "community_moderation_actions_post_id_action_revoked_at_expi_idx" ON "community_moderation_actions"("post_id", "action", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "community_moderation_actions_comment_id_action_revoked_at_e_idx" ON "community_moderation_actions"("comment_id", "action", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "community_moderation_actions_collection_id_action_revoked_a_idx" ON "community_moderation_actions"("collection_id", "action", "revoked_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "community_operation_restrictions_moderation_action_id_key" ON "community_operation_restrictions"("moderation_action_id");

-- AddForeignKey
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "learning_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "community_moderation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "community_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_moderation_actions" ADD CONSTRAINT "community_moderation_actions_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "learning_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_operation_restrictions" ADD CONSTRAINT "community_operation_restrictions_moderation_action_id_fkey" FOREIGN KEY ("moderation_action_id") REFERENCES "community_moderation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_appeals" ADD CONSTRAINT "community_appeals_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_appeals" ADD CONSTRAINT "community_appeals_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "community_moderation_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_appeals" ADD CONSTRAINT "community_appeals_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "content_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 替换旧的两类目标约束，继续要求且仅允许引用一个现有实体。
ALTER TABLE community_reports DROP CONSTRAINT community_report_one_target;
ALTER TABLE community_reports ADD CONSTRAINT community_reports_one_target CHECK (num_nonnulls(post_id, comment_id, profile_id, collection_id) = 1);
ALTER TABLE community_reports ADD CONSTRAINT community_reports_status CHECK (status IN ('pending', 'reviewing', 'resolved', 'rejected'));
ALTER TABLE community_appeals ADD CONSTRAINT community_appeals_one_target CHECK (num_nonnulls(action_id, review_id) = 1);
ALTER TABLE community_appeals ADD CONSTRAINT community_appeals_status CHECK (status IN ('pending', 'reviewing', 'resolved', 'rejected'));
CREATE UNIQUE INDEX community_appeals_open_action ON community_appeals(author_id, action_id) WHERE status IN ('pending', 'reviewing') AND action_id IS NOT NULL;
CREATE UNIQUE INDEX community_appeals_open_review ON community_appeals(author_id, review_id) WHERE status IN ('pending', 'reviewing') AND review_id IS NOT NULL;
UPDATE community_reports SET due_at = created_at + INTERVAL '2 days';
UPDATE content_reviews SET due_at = created_at + INTERVAL '2 days';

-- 为既有停用账号保留可申诉的具体状态依据；不改变账号状态或伪造历史条款。
INSERT INTO community_moderation_actions (id, actor_id, target_type, target_id, subject_id, action, reason, rule_code, metadata)
SELECT 'legacy-account-' || u.id, u.id, 'profile', u.id, u.id, 'ban',
       '历史账号状态为' || u.status::text || '，原处置条款未记录，请通过申诉核查。',
       '历史账号状态（原依据待核查）', jsonb_build_object('accountStatus', u.status::text, 'accountRevision', u.revision, 'imported', true)
FROM users u WHERE u.status <> 'active'
ON CONFLICT (id) DO NOTHING;

-- 既有功能限制原值不变，仅补上治理引用；历史未保存的条款明确标记待核查。
INSERT INTO community_moderation_actions (id, actor_id, target_type, target_id, subject_id, action, reason, rule_code, expires_at, revoked_at, revoked_by_id, created_at, metadata)
SELECT 'legacy-restriction-' || r.id, r.created_by_id, 'profile', r.user_id, r.user_id, 'restrict', r.reason,
       '历史功能限制（原依据待核查）', r.ends_at, r.revoked_at, r.revoked_by_id, r.created_at,
       jsonb_build_object('startsAt', r.starts_at, 'operations', r.operations, 'imported', true)
FROM community_operation_restrictions r WHERE r.moderation_action_id IS NULL
ON CONFLICT (id) DO NOTHING;
UPDATE community_operation_restrictions SET moderation_action_id = 'legacy-restriction-' || id WHERE moderation_action_id IS NULL;

ALTER TABLE "community_profiles" ADD COLUMN "interests_selected_at" TIMESTAMP(3);

-- 兼容旧版已完成引导或已满足兴趣关注条件的账号，仅补记完成状态。
UPDATE "community_profiles" AS profile
SET "interests_selected_at" = COALESCE(account."onboarding_completed_at", CURRENT_TIMESTAMP)
FROM "users" AS account
WHERE profile."user_id" = account."id"
  AND (account."onboarding_completed_at" IS NOT NULL OR (
    SELECT COUNT(*) FROM "community_topic_follows" AS follow
    WHERE follow."user_id" = profile."user_id"
  ) >= 3);

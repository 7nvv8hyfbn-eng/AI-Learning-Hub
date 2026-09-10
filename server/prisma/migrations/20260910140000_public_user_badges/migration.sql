ALTER TABLE "community_profiles"
  ADD COLUMN "custom_badges" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "hidden_automatic_badges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "community_profiles"
  ADD CONSTRAINT "community_profiles_custom_badges_array" CHECK (jsonb_typeof("custom_badges") = 'array' AND jsonb_array_length("custom_badges") <= 3),
  ADD CONSTRAINT "community_profiles_hidden_badges_codes" CHECK ("hidden_automatic_badges" <@ ARRAY['official', 'moderator', 'teacher', 'mentor']::TEXT[]);

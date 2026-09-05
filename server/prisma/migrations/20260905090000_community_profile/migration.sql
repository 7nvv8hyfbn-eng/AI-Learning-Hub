BEGIN;

ALTER TABLE community_profiles
  ADD COLUMN avatar_file_id TEXT,
  ADD COLUMN banner_file_id TEXT,
  ADD COLUMN location TEXT,
  ADD COLUMN website_url TEXT,
  ADD COLUMN pinned_post_id TEXT;

ALTER TABLE community_profiles
  ADD CONSTRAINT community_profiles_avatar_file_id_fkey
    FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT community_profiles_banner_file_id_fkey
    FOREIGN KEY (banner_file_id) REFERENCES files(id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT community_profiles_pinned_post_id_fkey
    FOREIGN KEY (pinned_post_id) REFERENCES community_posts(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX community_profiles_avatar_file_id_idx ON community_profiles(avatar_file_id);
CREATE INDEX community_profiles_banner_file_id_idx ON community_profiles(banner_file_id);
CREATE INDEX community_profiles_pinned_post_id_idx ON community_profiles(pinned_post_id);

COMMIT;

ALTER TABLE community_posts
  ADD COLUMN inline_references JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN quoted_post_id TEXT;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_quoted_post_id_fkey
  FOREIGN KEY (quoted_post_id) REFERENCES community_posts(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE community_posts ADD CONSTRAINT community_posts_no_self_quote CHECK (quoted_post_id IS NULL OR quoted_post_id <> id);
CREATE INDEX community_posts_quoted_post_id_status_deleted_at_idx ON community_posts(quoted_post_id, status, deleted_at);

ALTER TABLE community_post_topics ADD COLUMN manual BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE community_topics ADD COLUMN normalized_name TEXT;
-- 历史重名话题保留原 ID 与关联；同名的新投稿采用唯一的规范名称入口。
WITH names AS (
  SELECT id, lower(regexp_replace(normalize(btrim(name), NFKC), '\s+', '_', 'g')) AS canonical
  FROM community_topics
), ranked AS (
  SELECT id, canonical, row_number() OVER (PARTITION BY canonical ORDER BY id) AS position FROM names
)
UPDATE community_topics topic SET normalized_name = ranked.canonical FROM ranked
WHERE topic.id = ranked.id AND ranked.position = 1;
CREATE UNIQUE INDEX community_topics_normalized_name_key ON community_topics(normalized_name);

ALTER TABLE community_post_revisions
  ADD COLUMN inline_references_snapshot JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN quoted_post_id_snapshot TEXT;

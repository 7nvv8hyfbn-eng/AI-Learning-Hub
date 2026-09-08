ALTER TABLE "community_posts" ADD COLUMN "cover_file_id" TEXT;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_cover_file_id_fkey"
  FOREIGN KEY ("cover_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "community_post_revisions" ADD COLUMN "cover_file_id_snapshot" TEXT;

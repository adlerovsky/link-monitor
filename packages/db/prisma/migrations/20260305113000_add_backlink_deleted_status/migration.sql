DO $$
BEGIN
  ALTER TYPE "BacklinkStatus" ADD VALUE IF NOT EXISTS 'DELETED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Backlink"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Backlink_deletedAt_idx"
ON "Backlink"("deletedAt");

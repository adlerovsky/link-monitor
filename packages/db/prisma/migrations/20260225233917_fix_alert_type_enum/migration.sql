/*
  Warnings:

  - The values [MISSING,REL_CHANGED,ANCHOR_CHANGED,NOINDEX,STATUS_ERROR] on the enum `AlertType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AlertType_new" AS ENUM ('ACTIVE_TO_ISSUE', 'ISSUE_TO_LOST', 'TO_LOST');
ALTER TABLE "Alert" ALTER COLUMN "type" TYPE "AlertType_new" USING ("type"::text::"AlertType_new");
ALTER TYPE "AlertType" RENAME TO "AlertType_old";
ALTER TYPE "AlertType_new" RENAME TO "AlertType";
DROP TYPE "public"."AlertType_old";
COMMIT;

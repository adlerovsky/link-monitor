-- CreateEnum
CREATE TYPE "IssueReason" AS ENUM ('BLOCKED_OR_CAPTCHA', 'LINK_NOT_FOUND', 'HTTP_NOT_2XX', 'ANCHOR_MISMATCH', 'NOINDEX', 'CANONICAL_MISMATCH', 'OTHER');

-- DropForeignKey
ALTER TABLE "Check" DROP CONSTRAINT "Check_backlinkId_fkey";

-- AlterTable
ALTER TABLE "Check" ADD COLUMN     "anchorOk" BOOLEAN,
ADD COLUMN     "issueReason" "IssueReason";

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_backlinkId_fkey" FOREIGN KEY ("backlinkId") REFERENCES "Backlink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

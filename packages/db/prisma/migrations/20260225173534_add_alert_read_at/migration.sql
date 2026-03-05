/*
  Warnings:

  - You are about to drop the column `meta` on the `BacklinkEvent` table. All the data in the column will be lost.
  - You are about to drop the column `reason` on the `BacklinkEvent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "readAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BacklinkEvent" DROP COLUMN "meta",
DROP COLUMN "reason";

-- CreateIndex
CREATE INDEX "Alert_readAt_idx" ON "Alert"("readAt");

-- AddForeignKey
ALTER TABLE "BacklinkEvent" ADD CONSTRAINT "BacklinkEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

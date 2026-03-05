/*
  Warnings:

  - The `currency` column on the `Backlink` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('EUR', 'USD', 'UAH');

-- AlterTable
ALTER TABLE "Backlink" DROP COLUMN "currency",
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'EUR';

-- CreateIndex
CREATE INDEX "Backlink_projectId_status_idx" ON "Backlink"("projectId", "status");

-- CreateIndex
CREATE INDEX "Backlink_nextCheckAt_idx" ON "Backlink"("nextCheckAt");

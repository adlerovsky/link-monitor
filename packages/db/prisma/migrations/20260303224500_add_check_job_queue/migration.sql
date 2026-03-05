-- CreateEnum
CREATE TYPE "CheckJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "CheckJob" (
    "id" TEXT NOT NULL,
    "backlinkId" TEXT NOT NULL,
    "status" "CheckJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "workerId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CheckJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CheckJob_status_notBefore_idx" ON "CheckJob"("status", "notBefore");

-- CreateIndex
CREATE INDEX "CheckJob_leaseUntil_idx" ON "CheckJob"("leaseUntil");

-- CreateIndex
CREATE INDEX "CheckJob_backlinkId_createdAt_idx" ON "CheckJob"("backlinkId", "createdAt");

-- AddForeignKey
ALTER TABLE "CheckJob" ADD CONSTRAINT "CheckJob_backlinkId_fkey" FOREIGN KEY ("backlinkId") REFERENCES "Backlink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

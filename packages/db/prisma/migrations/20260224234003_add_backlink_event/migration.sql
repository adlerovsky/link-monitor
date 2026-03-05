-- CreateTable
CREATE TABLE "BacklinkEvent" (
    "id" TEXT NOT NULL,
    "backlinkId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklinkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BacklinkEvent_projectId_createdAt_idx" ON "BacklinkEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "BacklinkEvent_backlinkId_createdAt_idx" ON "BacklinkEvent"("backlinkId", "createdAt");

-- AddForeignKey
ALTER TABLE "BacklinkEvent" ADD CONSTRAINT "BacklinkEvent_backlinkId_fkey" FOREIGN KEY ("backlinkId") REFERENCES "Backlink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

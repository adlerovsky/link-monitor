-- CreateTable
CREATE TABLE "BillingEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "fromPlan" "Plan" NOT NULL,
  "toPlan" "Plan" NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'manual',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_createdAt_idx" ON "BillingEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BillingEvent_actorUserId_createdAt_idx" ON "BillingEvent"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingEvent"
ADD CONSTRAINT "BillingEvent_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent"
ADD CONSTRAINT "BillingEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

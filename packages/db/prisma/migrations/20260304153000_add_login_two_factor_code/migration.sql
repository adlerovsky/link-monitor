-- CreateTable
CREATE TABLE "LoginTwoFactorCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginTwoFactorCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginTwoFactorCode_userId_createdAt_idx" ON "LoginTwoFactorCode"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginTwoFactorCode_email_createdAt_idx" ON "LoginTwoFactorCode"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginTwoFactorCode_expiresAt_idx" ON "LoginTwoFactorCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "LoginTwoFactorCode" ADD CONSTRAINT "LoginTwoFactorCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

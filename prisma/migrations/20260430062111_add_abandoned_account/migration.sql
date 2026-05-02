-- CreateTable
CREATE TABLE "AbandonedAccount" (
    "id" TEXT NOT NULL,
    "providerIdHash" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "accountCreatedAt" TIMESTAMP(3) NOT NULL,
    "abandonedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastKnownIpHash" TEXT,
    "uniqueIpCount" INTEGER NOT NULL DEFAULT 0,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "violationNote" TEXT,
    "retainUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbandonedAccount_providerIdHash_idx" ON "AbandonedAccount"("providerIdHash");

-- CreateIndex
CREATE INDEX "AbandonedAccount_retainUntil_idx" ON "AbandonedAccount"("retainUntil");

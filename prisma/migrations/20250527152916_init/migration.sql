-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'CREW_MEMBER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('MATERIALS', 'EQUIPMENT', 'LABOR', 'SUBCONTRACTOR', 'PERMITS', 'FUEL', 'TOOLS', 'UTILITIES', 'INSURANCE', 'OTHER');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "quickbooksTokens" JSONB,
    "plaidTokens" JSONB,
    "emailForwarding" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CREW_MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clientName" TEXT,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "address" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budget" DOUBLE PRECISION,
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "quickbooksJobId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "vendorName" TEXT,
    "receiptDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "ocrData" JSONB,
    "ocrConfidence" DOUBLE PRECISION,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "isEmailReceipt" BOOLEAN NOT NULL DEFAULT false,
    "emailSource" TEXT,
    "quickbooksId" TEXT,
    "bankTransactionId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_email_key" ON "Company"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Company_emailForwarding_key" ON "Company"("emailForwarding");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

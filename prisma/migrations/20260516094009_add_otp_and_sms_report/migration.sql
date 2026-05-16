-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('UNUSED', 'USED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SmsProvider" AS ENUM ('SAYQAL', 'MOCK');

-- CreateEnum
CREATE TYPE "SmsType" AS ENUM ('OTP');

-- CreateTable
CREATE TABLE "Otp" (
    "id" UUID NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "OtpStatus" NOT NULL DEFAULT 'UNUSED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsReport" (
    "id" UUID NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "type" "SmsType" NOT NULL,
    "provider" "SmsProvider" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Otp_phoneHash_status_expiresAt_idx" ON "Otp"("phoneHash", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "SmsReport_phoneHash_createdAt_idx" ON "SmsReport"("phoneHash", "createdAt");

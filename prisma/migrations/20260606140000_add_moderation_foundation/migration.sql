-- Migration A (additive only): moderation foundation
-- Adds: UserRole enum, User.role, Report, UserSuspension, AdminAuditLog, DailyMetric.
-- Does NOT drop MessageAdminDeleteLog (drop happens in Migration B after backfill).

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_SPEECH', 'SEXUAL_CONTENT', 'VIOLENCE', 'IMPERSONATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReportResolution" AS ENUM ('DISMISSED', 'AUTO_CLOSED_TOMBSTONED', 'AUTO_CLOSED_SUSPENDED');

-- CreateEnum
CREATE TYPE "AdminAuditAction" AS ENUM (
  'MESSAGE_TOMBSTONE',
  'MESSAGE_UNTOMBSTONE',
  'USER_SUSPEND',
  'USER_UNSUSPEND',
  'REPORT_DISMISS',
  'REPORT_REVIEW_START',
  'ROLE_PROMOTE',
  'ROLE_DEMOTE'
);

-- CreateEnum
CREATE TYPE "AdminAuditTargetType" AS ENUM ('MESSAGE', 'USER', 'REPORT');

-- CreateEnum
CREATE TYPE "DailyMetricKind" AS ENUM (
  'MESSAGES_SENT_DIRECT',
  'MESSAGES_SENT_GROUP',
  'DAU',
  'NEW_USERS',
  'REPORTS_OPENED',
  'REPORTS_RESOLVED',
  'USERS_SUSPENDED'
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateTable
CREATE TABLE "Report" (
    "id" UUID NOT NULL,
    "reporterUserId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "freeText" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "ReportResolution",
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSuspension" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "suspendedByUserId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "revokeReason" TEXT,

    CONSTRAINT "UserSuspension_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "action" "AdminAuditAction" NOT NULL,
    "targetType" "AdminAuditTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyMetric" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "DailyMetricKind" NOT NULL,
    "dimension" TEXT,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterUserId_messageId_key" ON "Report"("reporterUserId", "messageId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_messageId_idx" ON "Report"("messageId");

-- CreateIndex
CREATE INDEX "Report_reporterUserId_createdAt_idx" ON "Report"("reporterUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reviewedByUserId_idx" ON "Report"("reviewedByUserId");

-- CreateIndex
CREATE INDEX "UserSuspension_userId_revokedAt_idx" ON "UserSuspension"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserSuspension_suspendedByUserId_idx" ON "UserSuspension"("suspendedByUserId");

-- CreateIndex
CREATE INDEX "UserSuspension_expiresAt_idx" ON "UserSuspension"("expiresAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorUserId_createdAt_idx" ON "AdminAuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyMetric_date_kind_dimension_key" ON "DailyMetric"("date", "kind", "dimension");

-- CreateIndex
CREATE INDEX "DailyMetric_kind_date_idx" ON "DailyMetric"("kind", "date");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSuspension" ADD CONSTRAINT "UserSuspension_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSuspension" ADD CONSTRAINT "UserSuspension_suspendedByUserId_fkey" FOREIGN KEY ("suspendedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSuspension" ADD CONSTRAINT "UserSuspension_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

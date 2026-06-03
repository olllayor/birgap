/*
  Warnings:

  - Added the required column `updatedAt` to the `MessageEnvelope` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "lastEditIdempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "MessageEnvelope" ADD COLUMN     "envelopeVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "MessageMedia" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "thumbnailBucketKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "mediaCiphertextHash" TEXT NOT NULL,
    "thumbnailCiphertextHash" TEXT,
    "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedAt" TIMESTAMP(3),
    "uploadSessionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiddenMessage" (
    "userId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenMessage_pkey" PRIMARY KEY ("userId","messageId")
);

-- CreateTable
CREATE TABLE "MessageAdminDeleteLog" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAdminDeleteLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageMedia_messageId_key" ON "MessageMedia"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageMedia_uploadSessionId_key" ON "MessageMedia"("uploadSessionId");

-- CreateIndex
CREATE INDEX "MessageMedia_bucketKey_idx" ON "MessageMedia"("bucketKey");

-- CreateIndex
CREATE INDEX "MessageMedia_uploadStatus_createdAt_idx" ON "MessageMedia"("uploadStatus", "createdAt");

-- CreateIndex
CREATE INDEX "MessageAdminDeleteLog_messageId_idx" ON "MessageAdminDeleteLog"("messageId");

-- CreateIndex
CREATE INDEX "MessageAdminDeleteLog_adminUserId_idx" ON "MessageAdminDeleteLog"("adminUserId");

-- CreateIndex
CREATE INDEX "MessageEnvelope_recipientDeviceId_updatedAt_idx" ON "MessageEnvelope"("recipientDeviceId", "updatedAt");

-- AddForeignKey
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAdminDeleteLog" ADD CONSTRAINT "MessageAdminDeleteLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

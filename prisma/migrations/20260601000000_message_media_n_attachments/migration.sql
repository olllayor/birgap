/*
  Warnings:

  - Made the column `messageId` on table `MessageMedia` nullable. The existing data was lost (the column was 1:1 unique; cleared in this migration).
  - Added the required column `userId` to the `MessageMedia` table without a default value. Existing rows cleared.

*/

-- Drop the 1:1 unique constraint and the existing FK so we can rebind messageId as nullable with SetNull
DROP INDEX IF EXISTS "MessageMedia_messageId_key";

-- Clear existing rows: in dev the table is empty, in prod a backfill plan is required (out of scope for this week)
DELETE FROM "MessageMedia";

-- DropForeignKey
ALTER TABLE "MessageMedia" DROP CONSTRAINT IF EXISTS "MessageMedia_messageId_fkey";

-- AlterTable: add userId
ALTER TABLE "MessageMedia" ADD COLUMN     "userId" UUID NOT NULL;

-- AlterTable: make bucketKey unique (was non-unique in the 1:1 migration; now N-per-message so we want unique-per-object)
CREATE UNIQUE INDEX "MessageMedia_bucketKey_key" ON "MessageMedia"("bucketKey");
DROP INDEX IF EXISTS "MessageMedia_bucketKey_idx";

-- AlterTable: make messageId nullable
ALTER TABLE "MessageMedia" ALTER COLUMN "messageId" DROP NOT NULL;

-- AddForeignKey: message -> media cascade-on-delete (was the original)
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: user -> media cascade-on-delete
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex: per-user upload status for orphan sweep
CREATE INDEX "MessageMedia_userId_uploadStatus_idx" ON "MessageMedia"("userId", "uploadStatus");

-- CreateIndex: per-message (non-unique) for fast lookup of message attachments
CREATE INDEX "MessageMedia_messageId_idx" ON "MessageMedia"("messageId");

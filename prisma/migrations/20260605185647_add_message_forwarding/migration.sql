-- DropIndex
DROP INDEX "MessageMedia_bucketKey_key";

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "forwarded" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "MessageMedia_bucketKey_idx" ON "MessageMedia"("bucketKey");

-- AlterTable: add columns needed by RefreshToken schema
ALTER TABLE "RefreshToken" ADD COLUMN     "familyId" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- Backfill existing rows with a unique familyId each
UPDATE "RefreshToken" SET "familyId" = gen_random_uuid()::text WHERE "familyId" IS NULL;

-- Now enforce NOT NULL
ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

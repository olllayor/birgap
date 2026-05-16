/*
  Warnings:

  - You are about to drop the column `blob` on the `BackupBlob` table. All the data in the column will be lost.
  - You are about to drop the column `checksum` on the `BackupBlob` table. All the data in the column will be lost.
  - You are about to drop the column `createdAt` on the `BackupBlob` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `BackupBlob` table. All the data in the column will be lost.
  - Added the required column `bucketKey` to the `BackupBlob` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sha256` to the `BackupBlob` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "BackupBlob" DROP COLUMN "blob",
DROP COLUMN "checksum",
DROP COLUMN "createdAt",
DROP COLUMN "updatedAt",
ADD COLUMN     "bucketKey" TEXT NOT NULL,
ADD COLUMN     "sha256" TEXT NOT NULL,
ADD COLUMN     "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

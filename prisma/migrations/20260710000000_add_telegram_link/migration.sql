-- AlterEnum
ALTER TYPE "SmsProvider" ADD VALUE 'TELEGRAM';

-- CreateTable
CREATE TABLE "TelegramLink" (
    "id" UUID NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "telegramUserId" BIGINT,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLink_phoneHash_key" ON "TelegramLink"("phoneHash");

-- CreateIndex
CREATE INDEX "TelegramLink_chatId_idx" ON "TelegramLink"("chatId");

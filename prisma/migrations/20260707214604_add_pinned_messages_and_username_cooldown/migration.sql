-- Two features:
--  1. Pinned messages (Telegram-style, multiple pins per chat). threadType/threadId
--     are polymorphic (direct thread or group) so they stay app-enforced, like
--     UnreadCounter. Pins cascade-delete with their message and with the pinning user.
--  2. Username change cooldown: usernameChangedAt records the last rename so
--     UsersService.updateProfile can rate-limit flapping / name-squatting.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "usernameChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PinnedMessage" (
    "id" UUID NOT NULL,
    "threadType" TEXT NOT NULL,
    "threadId" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "pinnedByUserId" UUID NOT NULL,
    "pinnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinnedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PinnedMessage_threadType_threadId_pinnedAt_idx" ON "PinnedMessage"("threadType", "threadId", "pinnedAt");

-- CreateIndex
CREATE INDEX "PinnedMessage_messageId_idx" ON "PinnedMessage"("messageId");

-- CreateIndex
CREATE INDEX "PinnedMessage_pinnedByUserId_idx" ON "PinnedMessage"("pinnedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PinnedMessage_threadType_threadId_messageId_key" ON "PinnedMessage"("threadType", "threadId", "messageId");

-- AddForeignKey
ALTER TABLE "PinnedMessage" ADD CONSTRAINT "PinnedMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedMessage" ADD CONSTRAINT "PinnedMessage_pinnedByUserId_fkey" FOREIGN KEY ("pinnedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

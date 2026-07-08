-- Per-user, per-direct-thread settings (currently just mute). A mutedUntil in
-- the future suppresses FCM push wakeups for that user's devices on new
-- messages in the thread; socket delivery and unread counting are unaffected.
-- "Muted forever" is stored as a far-future timestamp (9999-12-31).
-- Settings cascade-delete with the user and with the thread.

-- CreateTable
CREATE TABLE "ThreadSetting" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "mutedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ThreadSetting_threadId_idx" ON "ThreadSetting"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadSetting_userId_threadId_key" ON "ThreadSetting"("userId", "threadId");

-- AddForeignKey
ALTER TABLE "ThreadSetting" ADD CONSTRAINT "ThreadSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThreadSetting" ADD CONSTRAINT "ThreadSetting_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DirectThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

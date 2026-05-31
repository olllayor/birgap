CREATE INDEX "MessageEnvelope_recipientUserId_status_idx" ON "MessageEnvelope"("recipientUserId", "status");

CREATE TABLE "UnreadCounter" (
    "userId" UUID NOT NULL,
    "threadType" TEXT NOT NULL,
    "threadId" UUID NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnreadCounter_pkey" PRIMARY KEY ("userId","threadType","threadId")
);

CREATE INDEX "UnreadCounter_userId_idx" ON "UnreadCounter"("userId");

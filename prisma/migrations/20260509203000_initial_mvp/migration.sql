-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ANDROID', 'IOS', 'WEB');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('FCM', 'APNS', 'HMS');

-- CreateEnum
CREATE TYPE "EnvelopeStatus" AS ENUM ('PENDING', 'DELIVERED', 'READ');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneMasked" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "displayName" TEXT,
    "identityPublicKey" TEXT NOT NULL,
    "pushToken" TEXT,
    "pushPlatform" "PushPlatform",
    "pushActive" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignedPrekey" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "keyId" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignedPrekey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimePrekey" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "keyId" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OneTimePrekey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectThread" (
    "id" UUID NOT NULL,
    "userAId" UUID NOT NULL,
    "userBId" UUID NOT NULL,
    "latestSequence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DirectThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "senderDeviceId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "threadSequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEnvelope" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "recipientDeviceId" UUID NOT NULL,
    "ciphertext" JSONB NOT NULL,
    "status" "EnvelopeStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocketTicket" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "consumedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocketTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupBlob" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "blob" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackupBlob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");
CREATE INDEX "Device_userId_active_idx" ON "Device"("userId", "active");
CREATE INDEX "SignedPrekey_deviceId_active_idx" ON "SignedPrekey"("deviceId", "active");
CREATE UNIQUE INDEX "SignedPrekey_deviceId_keyId_key" ON "SignedPrekey"("deviceId", "keyId");
CREATE INDEX "OneTimePrekey_deviceId_consumedAt_idx" ON "OneTimePrekey"("deviceId", "consumedAt");
CREATE UNIQUE INDEX "OneTimePrekey_deviceId_keyId_key" ON "OneTimePrekey"("deviceId", "keyId");
CREATE UNIQUE INDEX "DirectThread_userAId_userBId_key" ON "DirectThread"("userAId", "userBId");
CREATE INDEX "Message_threadId_threadSequence_idx" ON "Message"("threadId", "threadSequence");
CREATE UNIQUE INDEX "Message_senderDeviceId_idempotencyKey_key" ON "Message"("senderDeviceId", "idempotencyKey");
CREATE UNIQUE INDEX "Message_threadId_threadSequence_key" ON "Message"("threadId", "threadSequence");
CREATE INDEX "MessageEnvelope_recipientDeviceId_status_idx" ON "MessageEnvelope"("recipientDeviceId", "status");
CREATE UNIQUE INDEX "MessageEnvelope_messageId_recipientDeviceId_key" ON "MessageEnvelope"("messageId", "recipientDeviceId");
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_revokedAt_idx" ON "RefreshToken"("userId", "revokedAt");
CREATE UNIQUE INDEX "SocketTicket_tokenHash_key" ON "SocketTicket"("tokenHash");
CREATE INDEX "SocketTicket_userId_deviceId_expiresAt_idx" ON "SocketTicket"("userId", "deviceId", "expiresAt");
CREATE UNIQUE INDEX "BackupBlob_userId_key" ON "BackupBlob"("userId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignedPrekey" ADD CONSTRAINT "SignedPrekey_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OneTimePrekey" ADD CONSTRAINT "OneTimePrekey_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DirectThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocketTicket" ADD CONSTRAINT "SocketTicket_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BackupBlob" ADD CONSTRAINT "BackupBlob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_senderDeviceId_fkey";

-- DropForeignKey
ALTER TABLE "MessageEnvelope" DROP CONSTRAINT "MessageEnvelope_recipientDeviceId_fkey";

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "fannedOutAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEnvelope" ADD CONSTRAINT "MessageEnvelope_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnreadCounter" ADD CONSTRAINT "UnreadCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenMessage" ADD CONSTRAINT "HiddenMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenMessage" ADD CONSTRAINT "HiddenMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "MessageEnvelope" ADD COLUMN     "envelopeSequence" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE INDEX "MessageEnvelope_recipientDeviceId_envelopeSequence_idx" ON "MessageEnvelope"("recipientDeviceId", "envelopeSequence");

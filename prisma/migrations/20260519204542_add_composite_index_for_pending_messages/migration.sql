-- DropIndex
DROP INDEX "MessageEnvelope_recipientDeviceId_envelopeSequence_idx";

-- DropIndex
DROP INDEX "MessageEnvelope_recipientDeviceId_status_idx";

-- CreateIndex
CREATE INDEX "MessageEnvelope_recipientDeviceId_status_envelopeSequence_idx" ON "MessageEnvelope"("recipientDeviceId", "status", "envelopeSequence");

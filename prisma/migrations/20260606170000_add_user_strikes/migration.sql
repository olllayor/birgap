-- Migration D: add user strike tracking.
-- strikeCount is a denormalized cache; the source of truth for individual
-- suspensions is the UserSuspension table (see GET /admin/users/:id/suspensions).
-- lastStrikeAt is the wall-clock time of the most recent suspension, used by
-- future "auto-action at N strikes within X days" policy work.

ALTER TABLE "User" ADD COLUMN "strikeCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "User" ADD COLUMN "lastStrikeAt" TIMESTAMP(3);

ALTER TYPE "AdminAuditAction" ADD VALUE 'STRIKE_RESET';

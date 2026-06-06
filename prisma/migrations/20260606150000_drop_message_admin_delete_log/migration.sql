-- Migration B (audit-log completion): drop MessageAdminDeleteLog.
-- Prerequisites (operator runbook, NOT in this migration):
--   1. Deploy Migration A (already done).
--   2. Run the backfill script:
--        pnpm admin:backfill-audit
--      This copies every MessageAdminDeleteLog row into AdminAuditLog as
--      (action=MESSAGE_TOMBSTONE, actorUserId=<adminUserId>, metadata.source='legacy',
--       metadata.originalId=<messageAdminDeleteLog.id>, metadata.deletedAt=<legacy row>).
--   3. Verify counts:
--        SELECT count(*) FROM "AdminAuditLog" WHERE metadata->>'source' = 'legacy';
--        SELECT count(*) FROM "MessageAdminDeleteLog";
--      They should match.
--   4. Deploy this migration. The audit log now lives in AdminAuditLog only.
--   5. (DBA, separate) REVOKE UPDATE, DELETE ON "AdminAuditLog" FROM <app_role>.

-- DropForeignKey
ALTER TABLE "MessageAdminDeleteLog" DROP CONSTRAINT "MessageAdminDeleteLog_messageId_fkey";

-- DropIndex
DROP INDEX "MessageAdminDeleteLog_messageId_idx";

-- DropIndex
DROP INDEX "MessageAdminDeleteLog_adminUserId_idx";

-- DropTable
DROP TABLE "MessageAdminDeleteLog";

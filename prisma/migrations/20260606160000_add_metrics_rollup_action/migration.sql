-- Migration C: add METRICS_ROLLUP value to AdminAuditAction enum.
-- Required by the manual /admin/analytics/rollup endpoint, which records
-- its invocation in the audit log so that re-rollups are traceable.
-- Safe and online: PG `ALTER TYPE ... ADD VALUE` does not rewrite the table
-- and can run while the app is serving reads on the existing enum values.

ALTER TYPE "AdminAuditAction" ADD VALUE 'METRICS_ROLLUP';

-- Drop redundant non-unique indexes on Message.
-- The matching @@unique(threadId, threadSequence) and @@unique(groupId, threadSequence)
-- constraints (added in earlier migrations) already provide a btree index that
-- covers the same lookup patterns, so the plain indexes only add write overhead.

DROP INDEX IF EXISTS "Message_threadId_threadSequence_idx";
DROP INDEX IF EXISTS "Message_groupId_threadSequence_idx";

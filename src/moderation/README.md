# Moderation Module

The Admin & Moderation Dashboard: report queue, audit log, user suspension, role management, and analytics. REST-only (`/admin/*` and `/reports`). No GraphQL.

## Two design rules pinned at the top of every review

### 1. Admin system never sees message ciphertext

The server is a zero-knowledge relay (see `docs/security-model.md`). The moderation system is no exception:

- `Report` stores: `reporterUserId`, `messageId`, `reason`, `freeText`, status metadata. **Not** the ciphertext.
- `AdminAuditLog` stores: actor, action, target type/id, reason, metadata. **Not** the ciphertext.
- `GET /admin/reports/:id` returns the report row plus a `message` projection: `{ id, senderUserId, createdAt, threadId, groupId, deletedAt }`. No `envelopes`, no `ciphertext` field.
- Tombstoning is a metadata mutation (`Message.deletedAt = now()`), not a content review. The moderator can never see what was said.

**Reviewer checklist:** when adding any new field to a moderation response shape, ask "could this expose the message body?" If yes, don't add it.

### 2. Admin endpoints are append-only on the audit log

`AdminAuditLog` is the accountability surface. Constraints:

- **No `PATCH` or `DELETE` endpoints** on the audit log.
- **No `UPDATE` or `DELETE` SQL grants** on the `AdminAuditLog` table for the application DB role. The migration `prisma/migrations/20260606140000_add_moderation_foundation/migration.sql` does not enforce this — it's a follow-up DBA step (`REVOKE UPDATE, DELETE ON "AdminAuditLog" FROM <app_role>`).
- **Retention: forever.** Audit logs are tiny and the one thing you most want to keep when something goes wrong.
- **Read access: `ADMIN` only.** `MODERATOR` cannot read the audit log, even rows they themselves created. This keeps the read surface as narrow as the privilege tier.

GDPR-style erasure is a DBA operation against the underlying DB, not an app operation.

---

## Module layout

```
src/moderation/
├── moderation.module.ts
├── controllers/
│   ├── reports.controller.ts        # POST /reports, GET /reports/mine
│   └── admin.controller.ts          # all /admin/* routes
├── services/
│   ├── reports.service.ts                # create, list, markInReview, dismiss
│   ├── moderation.service.ts             # tombstone, untombstone, suspend, unsuspend, changeRole
│   ├── audit-log.service.ts              # write, list
│   ├── analytics.service.ts              # read DailyMetric series
│   ├── admin-users.service.ts            # user detail, search
│   ├── admin-bootstrap.service.ts        # env-var promotions on boot
│   ├── daily-metrics-rollup.service.ts   # cron 00:30 UTC: roll up yesterday's metrics
│   └── suspension-reactivation.service.ts # cron 00:45 UTC: reactivate expired suspensions
├── guards/
│   └── admin-role.guard.ts          # reads @RequireRole metadata
├── exceptions/
│   └── account-suspended.exception.ts
├── dto/...
└── README.md
```

## Roles and permissions

| Action | USER | MODERATOR | ADMIN |
|---|:---:|:---:|:---:|
| `POST /reports` (file a report) | ✅ | ✅ | ✅ |
| `GET /reports/mine` | ✅ | ✅ | ✅ |
| `GET /admin/reports` queue | ❌ | ✅ | ✅ |
| `POST /admin/reports/:id/{review,dismiss}` | ❌ | ✅ | ✅ |
| `POST /admin/messages/:id/tombstone` | ❌ | ✅ | ✅ |
| `POST /admin/messages/:id/untombstone` | ❌ | ❌ | ✅ |
| `POST /admin/users/:id/{suspend,unsuspend}` | ❌ | ❌ | ✅ |
| `PATCH /admin/users/:id/role` | ❌ | ❌ | ✅ |
| `POST /admin/users/:id/strikes/reset` | ❌ | ❌ | ✅ |
| `GET /admin/users` + `/admin/users/:id` | ❌ | ❌ | ✅ |
| `GET /admin/analytics` | ❌ | ✅ | ✅ |
| `POST /admin/analytics/rollup` | ❌ | ❌ | ✅ |
| `GET /admin/audit-log` | ❌ | ❌ | ✅ |

Enforced by the `AdminRoleGuard` reading `@RequireRole(UserRole.X)` metadata on each handler. Cross-checks (e.g. "you cannot suspend an admin") live inside `ModerationService`.

## Bootstrap and role management

Two operator surfaces for managing roles; **never an HTTP endpoint**:

1. **`ADMIN_PHONE_HASHES` env var** — comma-separated list of phone hashes. On `onApplicationBootstrap`, `AdminBootstrapService` finds any matching `User` and ensures their role is at least `ADMIN`. Idempotent.
2. **CLI scripts** (gated by shell access):
   - `pnpm admin:promote <phoneE164> --role <MODERATOR|ADMIN> [--reason <text>]`
   - `pnpm admin:demote <phoneE164> --role <USER> [--reason <text>]`
   - `pnpm admin:backfill-audit` — one-time idempotent script to copy `MessageAdminDeleteLog` rows into `AdminAuditLog` (run between Migration A and Migration B).

Both surfaces write to `AdminAuditLog` with `actorUserId = null` and `metadata.source = 'env' | 'cli'`, so the trail is preserved.

## Suspension semantics

- `User.status = 'SUSPENDED'` (denormalized, fast JWT-guard check) plus `UserSuspension` row for history.
- `UserSuspension.expiresAt` nullable: `null` = permanent; set = timed auto-reactivate.
- **On suspend (single transaction):** create `UserSuspension` row, set `User.status = SUSPENDED`, revoke all of the user's unexpired `RefreshToken`s, tombstone all of the user's non-deleted messages, cascade-close all open reports against those messages, write `AdminAuditLog` rows.
- **After commit:** publish `realtime:user-kicked` on Redis. Every gateway node subscribes, finds local sockets for the user, emits `user.kicked`, disconnects.
- **JWT guard surfaces structured 403** (see `AccountSuspendedException`) with `{ error: 'ACCOUNT_SUSPENDED', reason, suspendedAt, expiresAt, appealUrl }`. Same body returned by `POST /auth/refresh` and `POST /auth/otp/verify` so a suspended user can't re-auth.
- **Push suppression:** the `PushNotificationProcessor` filters `Device.user.status = 'ACTIVE'` so suspended recipients don't get push wakeups. Their envelopes are still written to the DB, so when they're unsuspended they see the messages.

## Report flow

```
User files report ── POST /reports
   ↓
ReportsService.create
   ├─ check user.status ≠ SUSPENDED
   ├─ check message exists and not deleted
   ├─ check message.senderUserId ≠ reporterUserId
   ├─ check reporter is participant in thread or member of group
   ├─ check daily cap (50/day for USER, exempt for MOD/ADMIN)
   ├─ upsert Report row (idempotent on (reporter, message))
   └─ track collusion counter in Redis
   ↓
Report.status = OPEN
   ↓
Moderator opens report ── POST /admin/reports/:id/review
   → Report.status = IN_REVIEW, write AdminAuditLog(REPORT_REVIEW_START)
   ↓
Moderator dismisses ── POST /admin/reports/:id/dismiss
   → Report.status = CLOSED, resolution = DISMISSED, write AdminAuditLog(REPORT_DISMISS)
   ── OR ──
Moderator tombstones message ── POST /admin/messages/:id/tombstone { reportId }
   → tombstone message, cascade-close all open reports on this message with
     resolution = AUTO_CLOSED_TOMBSTONED, write AdminAuditLog(MESSAGE_TOMBSTONE)
   ↓
Realtime: emit `message.tombstoned.platform` → gateway routes to thread
participants or group members
```

## Module dependency direction

- `ReportsService` and `ModerationService` are siblings — neither calls the other.
- A "resolve" action is implemented as `ModerationService.tombstoneMessage({ reportId })`, which atomically writes the tombstone **and** the cascade-close within one `prisma.$transaction`. The report's resolution is set as a side effect of the primary moderation action. No circular dependency, no service-to-service coupling.
- `AuditLogService` is shared by all moderation services; it accepts an optional `tx: Prisma.TransactionClient` so audit writes can join the caller's transaction.

## Daily analytics rollup

`DailyMetricsRollupService` runs at **00:30 UTC** every day. It rolls up the *previous* day (00:00 UTC → 00:00 UTC) into seven `DailyMetric` rows:

| kind | dimension | source |
|---|---|---|
| `MESSAGES_SENT_DIRECT` | null | `Message.groupBy(groupId IS NULL)` |
| `MESSAGES_SENT_GROUP` | null | `Message.groupBy(groupId IS NOT NULL)` |
| `DAU` | null | distinct `Message.senderUserId` |
| `NEW_USERS` | null | `User.count` in range |
| `REPORTS_OPENED` | null | `Report.count(createdAt in range)` |
| `REPORTS_RESOLVED` | null | `Report.count(reviewedAt in range)` |
| `USERS_SUSPENDED` | null | `UserSuspension.count(suspendedAt in range)` |

The rollup is idempotent: `(date, kind, dimension)` is `@@unique`, and the upsert pattern is `(date, kind, dimension) → value`. Re-running for a past date is safe. Backfill is exposed via `POST /admin/analytics/rollup` (ADMIN-only, body `{ date: 'YYYY-MM-DD' }`); each manual call writes an `AdminAuditLog(METRICS_ROLLUP, metadata.date=...)` row so the trail is preserved.

## Auto-reactivation

`SuspensionReactivationService` runs at **00:45 UTC** every day. It finds `UserSuspension` rows where `expiresAt < now AND revokedAt IS NULL`, and for each:

- sets `UserSuspension.revokedAt = now`, `revokedByUserId = null`, `revokeReason = 'auto: expired'`
- flips `User.status` back to `ACTIVE`
- writes an `AdminAuditLog(USER_UNSUSPEND, actorUserId=null, metadata.source='auto-reactivation')` row inside the same transaction

The `actorUserId = null` distinguishes automatic system actions from manual admin lifts. Per-suspension failures are caught and logged so one bad row doesn't stop the rest of the batch.

## Data retention

The `database-prune` cron (3 AM UTC, `PruneProcessor`) now also prunes:

- `Report` rows where `createdAt < now - REPORT_RETENTION_DAYS` (default 365)
- `DailyMetric` rows where `date < now - DAILY_METRICS_RETENTION_DAYS` (default 365)

`AdminAuditLog` is **never** pruned (see Rule 2).

## Audit log search

`GET /admin/audit-log` accepts an optional `searchText` query parameter. When provided and at least 3 characters long, it filters by `reason ILIKE '%<text>%'` (case-insensitive substring). Shorter inputs are silently ignored to avoid pointless index scans on tiny strings.

The `metadata` JSONB column is not searched yet — a `GIN` index on `metadata` plus a `jsonb_path_ops` operator would be the natural follow-up once volume justifies it.

## User strikes

A `strike` is a denormalized tally on `User` that counts completed suspensions. The source of truth is still `UserSuspension` (visible via `GET /admin/users/:id/suspensions`); `User.strikeCount` is the fast lookup.

- `strikeCount` increments by 1 and `lastStrikeAt` is set to `now()` atomically inside the `suspendUser` transaction.
- Manual unsuspension does **not** decrement: a strike represents a past violation, not a current one.
- Auto-reactivation also does not decrement: a strike is permanent until an admin explicitly resets it.
- `POST /admin/users/:id/strikes/reset` (ADMIN-only) zeros the counter, clears `lastStrikeAt`, and writes `AdminAuditLog(STRIKE_RESET, metadata.previousCount=<N>)`. A reason is mandatory (recorded in the audit log).
- The strike is visible in `GET /admin/users/:id` (fields `strikeCount`, `lastStrikeAt`) and is the primary `orderBy` for the `GET /admin/users` search results, so repeat offenders surface first.

Auto-suspension policies (e.g. "3 strikes in 90 days → 7-day auto-suspend") and strike decay are deliberately not wired — they're a product decision, not a backend decision. The data is in place to make either easy to add later.

## Report rate limits

Two layers, both in `ReportsService.create`:

- **Per-user, per-day** (`REPORTS_DAILY_LIMIT`, default 50): Redis key `reports:daily:{userId}:{yyyymmdd}`, 36 h TTL. **USER** role only — `MODERATOR` and `ADMIN` are exempt.
- **Per-IP, per-minute** (`REPORTS_PER_IP_PER_MINUTE`, default 10): Redis key `reports:ip:{ip}:{yyyyMMddHHmm}`, 90 s TTL. **USER** role only — `MODERATOR` and `ADMIN` are exempt. Stops a single attacker from rotating accounts to file thousands of reports against a victim.

Both checks return `409 ConflictException` on overflow. Behind a load balancer you must set `TRUST_PROXY_HOPS` (default `0`) so `req.ip` is the client IP rather than the load balancer. **Never set it higher than the actual hop count** — a too-high value would let attackers spoof their IP via `X-Forwarded-For` and bypass the rate limit.

## Known follow-ups (not in this PR)

- **DBA grant tightening** on `AdminAuditLog`: `REVOKE UPDATE, DELETE` from the app DB role. Enforced out of band; the migration does not change grants.
- **Strike auto-policy**: schema is in place for "N strikes within X days → auto-suspend"; the policy itself is a product call.
- **Audit log free-text search across `metadata`**: a GIN index on `metadata` with `jsonb_path_ops` would let ops search "what did admin X do with the report about Y".

# Security Model

## Overview

BirGap implements a **zero-knowledge** security model. The server acts as an encrypted relay—it stores and forwards ciphertext without ever having the ability to decrypt message content, media, or backups. All cryptographic operations happen client-side.

## Threat Model

### What the Server Protects Against

1. **Network Eavesdropping**: All transport encrypted via TLS
2. **Server Compromise**: Server stores only encrypted blobs and public keys
3. **Database Leaks**: Phone numbers stored as SHA-256 hashes, not plaintext
4. **Replay Attacks**: Idempotency keys prevent message duplication
5. **Session Hijacking**: Refresh token rotation invalidates old tokens on use

### What the Server Cannot Protect Against

1. **Client Compromise**: If a device is compromised, attacker has access to decrypted messages
2. **Man-in-the-Middle**: Clients must verify safety numbers (identity key fingerprints)
3. **Metadata Analysis**: Server can see who communicates with whom and when
4. **Backup Key Loss**: If user loses backup password, encrypted backups are unrecoverable

## Cryptographic Architecture

### Signal Protocol Compatibility

BirGap's prekey management follows the Signal Protocol's X3DH (Extended Triple Diffie-Hellman) pattern:

```
Identity Key (IK) ──────── Long-term key pair per device
    │
Signed PreKey (SPK) ────── Medium-term key pair, signed by IK
    │                      Rotated periodically (default: 7 days)
One-Time PreKey (OTK) ──── Single-use key pairs
                           Consumed on first session establishment
```

### Key Hierarchy

```
User Identity
    │
    └─ Device 1
         ├─ Identity Key Pair (IK1)
         │    └─ Signs all SPKs for this device
         ├─ Signed PreKey (SPK1) ← Active
         │    └─ Previous SPKs marked inactive
         └─ One-Time PreKeys [OTK1, OTK2, OTK3, ...]
              └─ Consumed one at a time
    │
    └─ Device 2
         ├─ Identity Key Pair (IK2)
         ├─ Signed PreKey (SPK2) ← Active
         └─ One-Time PreKeys [OTK1, OTK2, ...]
```

### Session Establishment

When Alice wants to send a message to Bob:

1. Alice fetches Bob's key bundles: `GET /users/:bobId/devices/key-bundles`
2. For each of Bob's devices, Alice gets:
   - Bob's identity public key
   - Bob's active signed prekey (with signature)
   - One unconsumed one-time prekey (if available)
3. Alice's client performs X3DH locally to derive session keys
4. Alice encrypts message with derived keys
5. Alice sends ciphertext envelope to server
6. Server stores opaque ciphertext—**cannot decrypt**

### What the Server Stores

| Data Type | Encrypted? | Server Can Read? |
|-----------|------------|------------------|
| Message content | Yes (client-side) | No |
| Media content | Yes (client-side) | No |
| Backup content | Yes (client-side) | No |
| Identity public keys | No | Yes |
| Signed prekeys | No | Yes |
| One-time prekeys | No | Yes |
| Ciphertext envelopes | Yes (client-side) | No |
| Phone numbers | Hashed (SHA-256) | No (only hashes) |
| Device metadata | No | Yes |
| Message metadata | No | Yes (thread ID, sequence, timestamps) |

## Authentication Security

### OTP Authentication Flow

```
Client                          Server                          Sayqal SMS
  │                               │                               │
  ├─ POST /auth/otp/request ─────►│                               │
  │  { phone: "+99890..." }       │                               │
  │                               │                               │
  │                               │ 1. Generate 6-digit OTP       │
  │                               │ 2. Store in DB (hashed phone) │
  │                               │ 3. Send via SMS provider ──────────────►│
  │                               │                               │
  │◄─ { phone, mode, expires } ───┤                               │
  │                               │                     ◄─────────┤ SMS delivered
  │                               │                               │
  │  User enters code             │                               │
  │                               │                               │
  ├─ POST /auth/otp/verify ──────►│                               │
  │  { phone, code }              │                               │
  │                               │ 1. Validate OTP (timing-safe) │
  │                               │ 2. Mark as USED               │
  │                               │ 3. Upsert user                │
  │                               │ 4. Issue token pair           │
  │                               │                               │
  │◄─ { user, accessToken, refreshToken }                          │
```

**OTP Security Properties**:
- 6-digit codes, 5-minute TTL (configurable)
- Stored with SHA-256 hashed phone number
- 2-minute cooldown between requests per phone
- Maximum 5 failed verification attempts
- 15-minute lockout after max attempts
- Timing-safe comparison prevents timing attacks
- Every SMS attempt logged to `SmsReport` table

### Token Architecture

```
Access Token (JWT)
├─ TTL: 15 minutes (default)
├─ Payload: { sub: userId, sid: sessionId }
├─ Used for: REST API authentication
└─ Storage: Client memory (not persistent)

Refresh Token (Opaque)
├─ TTL: 30 days (default)
├─ Format: Random 48-byte token
├─ Storage: Hashed (SHA-256) in database
├─ Rotation: Old token revoked on use
└─ Used for: Obtaining new access tokens

Socket Ticket (Single-Use)
├─ TTL: 60 seconds (default)
├─ Format: Random 32-byte token
├─ Storage: Hashed (SHA-256) in database
├─ Consumption: One-time use only
└─ Used for: WebSocket authentication
```

### Refresh Token Rotation

```
Client                          Server
  │                               │
  ├─ POST /auth/refresh ─────────►│
  │  { refreshToken: "RT-1" }     │
  │                               │
  │  1. Validate RT-1             │
  │  2. Revoke RT-1               │
  │  3. Issue new AT + RT-2       │
  │                               │
  │◄─ { accessToken, refreshToken: "RT-2" }
  │                               │
```

**Security benefit**: If an attacker steals a refresh token, using it invalidates the legitimate client's token, alerting the user.

### WebSocket Ticket Authentication

```
Client                          Server
  │                               │
  ├─ POST /realtime/token ───────►│
  │  (with valid access token)    │
  │                               │
  │◄─ { ticket: "single-use" } ───┤
  │                               │
  ├─ Socket.IO connect ──────────►│
  │  auth: { ticket }             │
  │                               │
  │  1. Consume ticket (one-time) │
  │  2. Verify session still valid│
  │  3. Join user/device rooms    │
  │                               │
  │◄─ presence.active ────────────┤
  │                               │
```

**Security benefit**: WebSocket connections don't use the access token directly. Tickets are short-lived and single-use.

## Authorization Model

### Device Ownership Validation

All mutations require the device to belong to the authenticated user:

```typescript
// Every protected endpoint validates:
const device = await prisma.device.findFirst({
  where: { id: deviceId, userId: user.userId, active: true },
});
if (!device) {
  throw new ForbiddenException('Device belongs to another user');
}
```

### Endpoint Authorization Matrix

| Endpoint | Auth Required | Role Required | Device Validation |
|----------|---------------|---------------|-------------------|
| `POST /auth/otp/request` | No | — | No |
| `POST /auth/otp/verify` | No | — | No |
| `POST /auth/refresh` | No (uses refresh token) | — | No |
| `POST /auth/logout` | Yes (JWT) | any | Current session |
| `POST /devices/register` | Yes (JWT) | any | User owns device |
| `GET /devices` | Yes (JWT) | any | Current user only |
| `DELETE /devices/:id` | Yes (JWT) | any | User owns device |
| `POST /devices/:id/prekeys/refill` | Yes (JWT) | any | User owns device |
| `PUT /devices/:id/signed-prekey` | Yes (JWT) | any | User owns device |
| `GET /users/:id/key-bundles` | Yes (JWT) | any | Any user |
| `POST /messages` | Yes (JWT) | any | Sender device owned |
| `GET /messages/pending` | Yes (JWT) | any | Device owned by user |
| `POST /messages/:id/ack` | Yes (JWT) | any | Device owned by user |
| `POST /realtime/token` | Yes (JWT) | any | Device owned by user |
| `PUT /backups/current` | Yes (JWT) | any | Current user only |
| `GET /backups/current` | Yes (JWT) | any | Current user only |
| `GET /health` | No | — | No |
| `POST /reports` | Yes (JWT) | any | Sender device owned |
| `GET /reports/mine` | Yes (JWT) | any | Current user only |
| `GET /admin/me` | Yes (JWT) | any | — |
| `GET /admin/reports` | Yes (JWT) | MODERATOR or ADMIN | — |
| `GET /admin/reports/:id` | Yes (JWT) | MODERATOR or ADMIN | — |
| `POST /admin/reports/:id/review` | Yes (JWT) | MODERATOR or ADMIN | — |
| `POST /admin/reports/:id/dismiss` | Yes (JWT) | MODERATOR or ADMIN | — |
| `POST /admin/messages/:id/tombstone` | Yes (JWT) | MODERATOR or ADMIN | — |
| `POST /admin/messages/:id/untombstone` | Yes (JWT) | **ADMIN only** | — |
| `GET /admin/users` | Yes (JWT) | ADMIN | — |
| `GET /admin/users/:id` | Yes (JWT) | ADMIN | — |
| `POST /admin/users/:id/suspend` | Yes (JWT) | **ADMIN only** | — |
| `POST /admin/users/:id/unsuspend` | Yes (JWT) | **ADMIN only** | — |
| `GET /admin/users/:id/suspensions` | Yes (JWT) | ADMIN | — |
| `PATCH /admin/users/:id/role` | Yes (JWT) | **ADMIN only** | — |
| `POST /admin/users/:id/strikes/reset` | Yes (JWT) | **ADMIN only** | — |
| `GET /admin/analytics` | Yes (JWT) | MODERATOR or ADMIN | — |
| `POST /admin/analytics/rollup` | Yes (JWT) | **ADMIN only** | — |
| `GET /admin/audit-log` | Yes (JWT) | **ADMIN only** | — |

Role enforcement is layered: the `AdminRoleGuard` reads `@RequireRole(UserRole.X)` metadata on the handler and rejects with `403 Forbidden` if the JWT subject's role is below the requirement. The service layer adds a second cross-check (e.g. "you cannot suspend an admin") that runs even when the guard passes.

### Account Suspension Semantics

`User.status` is denormalized for the fast JWT-guard check; `UserSuspension` is the source-of-truth history.

- On suspend, the suspended user's `status` is flipped to `SUSPENDED`, all unexpired `RefreshToken`s are revoked, and a `UserSuspension` row is created (with `expiresAt` for timed suspensions, `null` for permanent).
- Subsequent REST calls hit `JwtAuthGuard` first; if `user.status === 'SUSPENDED'`, the guard throws `AccountSuspendedException` with a structured 403 body (see `api-reference.md` → Account Suspension Response Shape) before any controller code runs.
- Realtime eviction is via a Redis pub/sub channel `realtime:user-kicked` so a suspension on one node disconnects the user on every node. See [WebSocket Events Contract](./websocket-events.md) → Forced Disconnect.
- Auto-reactivation: the `SuspensionReactivationService` cron at 00:45 UTC flips `User.status` back to `ACTIVE` when `expiresAt` is in the past, writes `AdminAuditLog(USER_UNSUSPEND, actorUserId=null, metadata.source='auto-reactivation')`. Manual unsuspension does the same thing but with `actorUserId` set to the admin.
- Push suppression: `PushNotificationProcessor` filters `Device.user.status = 'ACTIVE'` on all device queries, so suspended recipients don't get push wakeups for messages that are already in their mailbox (they see them when they come back).

## Rate Limiting

| Scope | Limit | Window | Purpose |
|-------|-------|--------|---------|
| Default | 60 requests | 60 seconds | General API protection (ThrottlerModule) |
| Auth | 5 requests | 60 seconds | OTP brute-force prevention (ThrottlerModule) |
| OTP cooldown | 1 request | 120 seconds | Per-phone resend cooldown |
| OTP attempts | 5 failed | 900 seconds | Per-phone lockout threshold |
| Reports, per user | 50 reports | 1 day | USER only; prevents one user flooding the queue (Redis `reports:daily:{userId}:{yyyymmdd}`) |
| Reports, per IP | 10 reports | 1 minute | USER only; prevents an attacker rotating accounts to file many reports against one victim (Redis `reports:ip:{ip}:{yyyyMMddHHmm}`) |

The two report limits are checked in `ReportsService.create`. The IP check is skipped when `req.ip` is unavailable; in production behind a load balancer, set `TRUST_PROXY_HOPS` to the number of trusted proxy hops so `req.ip` resolves to the client IP. **Never set `TRUST_PROXY_HOPS` higher than the actual hop count** — a too-high value would let an attacker spoof the IP via `X-Forwarded-For` and bypass the limit.

## Input Validation

All inputs validated with `class-validator`:

- Phone numbers: Normalized and hashed
- Idempotency keys: 8-128 characters
- Prekey arrays: 1-200 items
- Device platforms: Enum validation (ANDROID, IOS, WEB)
- Push platforms: Enum validation (FCM, APNS, HMS)
- Message statuses: Enum validation (DELIVERED, READ)

## Data Protection

### Phone Number Privacy

```
Input: "+1234567890"
  │
  ├─ Normalized: "+1234567890"
  ├─ Hashed: SHA-256("+1234567890") → stored in DB
  └─ Masked: "+123****890" → returned to client
```

Phone numbers are **never stored in plaintext**. Only SHA-256 hashes are persisted.

### Refresh Token Storage

```
Generated: "random-48-byte-hex-string"
  │
  └─ Stored: SHA-256(token) → tokenHash column
```

Refresh tokens are **hashed before storage**. Even if the database is compromised, tokens cannot be reconstructed.

### Socket Ticket Storage

```
Generated: "random-32-byte-hex-string"
  │
  └─ Stored: SHA-256(ticket) → tokenHash column
```

Single-use tickets are **hashed before storage** and marked as consumed after use.

## Multi-Device Security

### Device Limits

- Maximum **3 active devices** per user (configurable)
- Deactivating a device immediately revokes its ability to:
  - Receive pending messages
  - Authenticate WebSocket connections
  - Send messages

### Sender-Sync Envelopes

When Alice sends a message to Bob, she can include envelopes for her own other devices:

```json
{
  "envelopes": [
    { "recipientDeviceId": "bob-device-1", "ciphertext": {...} },
    { "recipientDeviceId": "alice-device-2", "ciphertext": {...} },
    { "recipientDeviceId": "alice-device-3", "ciphertext": {...} }
  ]
}
```

**Validation**: Server ensures all envelope devices belong to either the sender or recipient.

## Push Notification Security

### Silent Notifications

Push notifications contain **no message content**:

```json
{
  "data": { "type": "new_message" }
}
```

iOS uses `contentAvailable: true` for silent background wakeups.

### Stale Token Cleanup

FCM automatically invalidates stale tokens:

```typescript
if (error.code === 'messaging/registration-token-not-registered') {
  // Clear token from database
  await prisma.device.updateMany({
    where: { pushToken: { in: staleTokens } },
    data: { pushToken: null, pushPlatform: null, pushActive: false },
  });
}
```

## Backup Security

### Client-Side Encryption

```
Client Workflow:
1. Export chat state
2. Encrypt with user password/key
3. Upload encrypted blob to server
4. Server stores opaque blob + metadata

Server Workflow:
1. Generate presigned upload URL
2. Client uploads directly to R2
3. Client registers blob metadata
4. Server verifies object exists in R2
5. Server stores metadata (sha256, size, version)
```

**Server cannot decrypt backups**—only stores encrypted blobs and integrity checksums.

### Backup Versioning

- One backup blob per user (upsert on upload)
- Old blob deleted from R2 after new upload
- Version number incremented by client
- SHA-256 checksum for integrity verification

## Security Best Practices for Clients

### Mandatory Rules

1. **Never send plaintext messages** to the backend
2. **Never send private keys** to the backend
3. **Never include message text** in push notification assumptions
4. **Always use idempotency keys** for message sends
5. **Always verify device ownership** before trusting key bundles
6. **Support `oneTimePrekey: null`** fallback for session initialization

### Recommended Practices

1. **Verify safety numbers** when identity keys change
2. **Rotate signed prekeys** every 7 days
3. **Refill one-time prekeys** when count drops below 10
4. **Use threadSequence** for final message ordering (not envelopeSequence)
5. **Pending-sync after reconnect** or push wakeup
6. **Expire typing indicators** after 3 seconds client-side
7. **Store tokens securely** (Keychain on iOS, Keystore on Android)

## Error Handling Security

| HTTP Code | Meaning | Client Action |
|-----------|---------|---------------|
| 401 | Token expired/invalid | Refresh token once, then retry |
| 403 | Device/session revoked | Stop using this device/session |
| 404 | Resource not found | Resource doesn't exist or not accessible |
| 409 | Max devices reached | Show device removal UI |
| 400 | Invalid request | Fix request parameters |

## Audit Considerations

### What is Logged

- Authentication attempts (success/failure)
- OTP generation and verification events
- SMS delivery attempts and results (provider, success, errors)
- Device registration/deactivation
- Message send/receive events (metadata only)
- Push notification delivery attempts
- Backup upload/download events

### What is NOT Logged

- Message content
- Ciphertext payloads
- Private keys
- Phone numbers (only hashes)
- Refresh token values (only hashes)

## Admin Audit Log

`AdminAuditLog` is the accountability surface for every moderation action. It is **append-only**: no `PATCH` or `DELETE` endpoint exists, and the daily prune job skips it. The retention policy is "keep forever" — the table is small relative to messages, and audit history is the one thing you most want to keep when something goes wrong.

### What's recorded

| `action` | `targetType` | Triggered by | Notable `metadata` |
|----------|--------------|--------------|--------------------|
| `MESSAGE_TOMBSTONE` | `MESSAGE` | `POST /admin/messages/:id/tombstone` (mod tombstone); also the group-admin tombstone path in `MessagesService.delete` | `scope='platform' \| 'group'`, `reportId`, `cascadeFrom='USER_SUSPEND'` |
| `MESSAGE_UNTOMBSTONE` | `MESSAGE` | `POST /admin/messages/:id/untombstone` (ADMIN only) | — |
| `USER_SUSPEND` | `USER` | `POST /admin/users/:id/suspend` | `suspensionId`, `expiresAt`, `tombstonedMessageCount`, `reportId` |
| `USER_UNSUSPEND` | `USER` | `POST /admin/users/:id/unsuspend` (manual) **or** the auto-reactivation cron | Manual: `suspensionId`. Auto: `source='auto-reactivation'`, `suspensionId`, `expiresAt`. `actorUserId` is `null` for auto. |
| `REPORT_DISMISS` | `REPORT` | `POST /admin/reports/:id/dismiss` | `reason` carries the moderator's justification |
| `REPORT_REVIEW_START` | `REPORT` | `POST /admin/reports/:id/review` | — |
| `ROLE_PROMOTE` / `ROLE_DEMOTE` | `USER` | `PATCH /admin/users/:id/role` | `from`, `to` |
| `METRICS_ROLLUP` | `USER` (the actor) | `POST /admin/analytics/rollup` | `date`, `written` (row count) |
| `STRIKE_RESET` | `USER` | `POST /admin/users/:id/strikes/reset` | `previousCount` |

`actorUserId` is `null` for system writes:
- Env-var bootstrap (`AdminBootstrapService` on app start, `metadata.source='env'`)
- CLI scripts (`pnpm admin:promote` / `admin:demote`, `metadata.source='cli'`)
- Auto-reactivation cron (`metadata.source='auto-reactivation'`)

`metadata.source='legacy'` is reserved for the one-time backfill of pre-moderation `MessageAdminDeleteLog` rows (see `prisma/scripts/backfill-admin-audit-log.ts`).

### What is NEVER recorded

Per the zero-knowledge model, the admin audit log never sees:
- Message ciphertext
- Message plaintext or media content
- Per-device `envelopes` (only the message id and metadata)

`GET /admin/reports/:id` returns a `message` projection with `{id, senderUserId, createdAt, threadId, groupId, deletedAt}` — no `envelopes`, no `ciphertext`. Tombstoning is a metadata mutation (`Message.deletedAt = now()`), not a content review.

### Read access

`GET /admin/audit-log` is **ADMIN only**. `MODERATOR` cannot read the audit log, even rows they themselves created. This keeps the read surface as narrow as the privilege tier. Operators needing read access in production should use a separate read-only DB role that can `SELECT` from `AdminAuditLog` but cannot `INSERT`, `UPDATE`, or `DELETE`.

### Operational hardening (DBA, out of band)

After running the moderation foundation migration, the DBA should:

```sql
REVOKE INSERT, UPDATE, DELETE ON "AdminAuditLog" FROM <app_role>;
-- Application retains SELECT + INSERT only.
-- INSERT-only on AdminAuditLog should be enforced by grant.
```

The app uses Prisma, so an attacker who gets app-level RCE cannot `UPDATE` or `DELETE` audit rows because the DB role doesn't have the grant. The application still has `INSERT` because that's the only legitimate write path.

## Future Security Enhancements

- [ ] Certificate pinning for mobile clients
- [ ] Safety number verification UI
- [ ] Message expiration/TTL
- [ ] Forward secrecy via ratchet key exchange
- [ ] Quantum-resistant key exchange (post-quantum cryptography)
- [ ] Hardware security key support (WebAuthn)
- [ ] Encrypted push notification payloads (when supported)
- [ ] SMS provider fallback (secondary provider on failure)
- [ ] JWT key rotation with multiple signing keys
- [ ] Device fingerprinting for anomaly detection
- [ ] Strike auto-policy (e.g. "3 strikes in 90 days → 7-day auto-suspend")
- [ ] GIN index on `AdminAuditLog.metadata` for free-text ops search
- [ ] User-facing appeal endpoint (`POST /auth/appeal` → queues for admin review)
- [ ] Per-IP ThrottlerModule tier for /reports (alongside the in-service check)

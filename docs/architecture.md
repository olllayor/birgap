# BirGap Architecture Overview

## System Architecture

BirGap is a backend relay for an end-to-end encrypted (E2EE) 1:1 messenger. The server **never sees plaintext messages**—it only stores public key material and opaque encrypted payloads that are encrypted client-side.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Mobile Clients                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Android    │  │     iOS      │  │     Web      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API Gateway / Load Balancer                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐
│   REST API       │ │  WebSocket   │ │   Health Check   │
│   (NestJS)       │ │  Gateway     │ │   Endpoint       │
│                  │ │  (Socket.IO) │ │                  │
└────────┬─────────┘ └──────┬───────┘ └──────────────────┘
         │                  │
         └─────────┬────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌──────────┐
│PostgreSQL│  │  Redis   │  │  R2/S3   │
│ (Prisma) │  │ (Cache)  │  │ (Backup) │
└─────────┘  └──────────┘  └──────────┘
                   │
                   ▼
          ┌─────────────────┐
          │  FCM/APNS/HMS   │
          │ (Push Notify)   │
          └─────────────────┘
```

## Core Design Principles

1. **Zero-Knowledge**: Server cannot decrypt messages, media, or backups
2. **Envelope Model**: Each message has per-device encrypted ciphertext envelopes
3. **Idempotent Operations**: Message sends use client-generated idempotency keys
4. **Sequence Ordering**: Server-assigned monotonic sequence numbers per thread
5. **Multi-Device Sync**: Up to 3 active devices per user with sender-sync envelopes
6. **Signal Protocol Compatible**: Prekey management follows Signal Protocol patterns
7. **Opaque Content Types**: Messages carry a `contentType` tag (`TEXT` / `LOCATION` / `VENUE`) for client-side rendering hints (notification previews, thread list previews). The tag is the only non-encrypted field on the message — actual content lives inside the ciphertext envelope and is invisible to the server.

## Module Architecture

```
src/
├── auth/              # Authentication (OTP, JWT, refresh tokens)
├── backups/           # Encrypted backup blob management
├── common/            # Shared utilities, guards, decorators, config
│   ├── config/        # Environment validation
│   ├── decorators/    # Custom decorators (@CurrentUser, @RequireRole)
│   ├── filters/       # Exception filters
│   ├── guards/        # JWT auth guard (with suspension check)
│   ├── tasks/         # Scheduled jobs (prune, media cleanup)
│   ├── types/         # TypeScript type definitions
│   └── utils/         # Crypto utilities
├── devices/           # Device registration and lifecycle
├── health/            # Health checks (Postgres, Redis)
├── messages/          # Message envelope relay and sequencing
├── moderation/        # Admin & moderation dashboard: reports, tombstones, suspensions, audit log, analytics
├── prekeys/           # Cryptographic prekey management
├── prisma/            # Database service and schema
├── push/              # Push notification service (FCM)
├── realtime/          # WebSocket gateway, ticket auth, user-kicked subscription
├── redis/             # Redis connection and device socket mapping
├── storage/           # Cloudflare R2/S3 storage service
└── users/             # User lookup and key bundle retrieval
```

## Module Dependencies

```
AppModule
├── ConfigModule (global, with Joi validation)
├── ThrottlerModule (rate limiting: default 60/min, auth 5/min)
├── EventEmitterModule (internal event bus)
├── ScheduleModule (@nestjs/schedule for cron jobs)
├── PrismaModule (database ORM)
├── RedisModule (caching layer)
├── AuthModule ─────────────────────────────────┐
├── UsersModule ────────────────────────────────┤
├── DevicesModule ──────────────────────────────┤
├── PreKeysModule ──────────────────────────────┤
├── MessagesModule ─────────────────────────────┤
├── ModerationModule ───────────────────────────┤  (depends on MessagesModule for AuditLogService)
├── RealtimeModule ─────────────────────────────┤
├── PushModule ─────────────────────────────────┤
├── BackupsModule ──────────────────────────────┤
├── StorageModule ──────────────────────────────┤
└── HealthModule ───────────────────────────────┘
```

**Moderation module** is the home of the admin dashboard and is wired last because it depends on `MessagesModule` only for the shared `AuditLogService` (the group-admin tombstone path writes to the audit log inside the same transaction as the message update). `ReportsService` and `ModerationService` are siblings — neither calls the other; the report resolution is a side effect of a tombstone or suspend, written in the same `prisma.$transaction`.

## Data Flow Diagrams

### Authentication Flow

```
Client                          Server
  │                               │
  ├─ POST /auth/otp/request ─────►│
  │  { phone: "+1234567890" }     │
  │                               │
  │◄─ 202 Accepted ───────────────┤
  │  { phone: "+123****90" }      │
  │                               │
  ├─ POST /auth/otp/verify ──────►│
  │  { phone, code: "000000" }    │
  │                               │
  │◄─ 200 OK ─────────────────────┤
  │  { accessToken, refreshToken }│
  │                               │
```

### Direct Message Send Flow

```
Sender Client                    Server                     Recipient Client
     │                              │                              │
     ├─ GET /users/:id/key-bundles ─►                              │
     │◄─ { devices: [key bundles] }─┤                              │
     │                              │                              │
     ├─ POST /messages ────────────►│                              │
     │  { envelopes: [...] }        │                              │
     │                              ├─ emit message.new ──────────►│
     │                              ├─ push notification (async) ─►│
     │                              │                              │
     │◄─ 200 OK ────────────────────┤                              │
     │  { id, threadSequence }      │                              │
     │                              │                              │
     │                              │◄─ POST /messages/:id/ack ────┤
     │                              │   { status: "DELIVERED" }    │
     │◄─ emit message.ack ──────────┤                              │
     │                              │                              │
```

### Group Message Send Flow

```
Sender Client                    Server                     Recipient Clients
     │                              │                              │
     ├─ POST /groups/:id/messages ─►│                              │
     │  { ciphertext }              │                              │
     │                              ├─ Queue job (group-fanout)   │
     │◄─ 200 OK ────────────────────┤                              │
     │  { queued: true }              │                              │
     │                              │                              │
     │                         Processor (async)                   │
     │                              │                              │
     │                              ├─ Single query: active devices│
     │                              ├─ Batch insert envelopes      │
     │                              ├─ emit message.new ─────────►│
     │                              ├─ push notification (async) ──►│
     │                              │                              │
```

### WebSocket Connection Flow

```
Client                          Server
  │                               │
  ├─ POST /realtime/token ───────►│
  │  { deviceId: "uuid" }         │
  │                               │
  │◄─ { ticket, expiresAt } ──────┤
  │                               │
  ├─ Socket.IO connect ──────────►│
  │  auth: { ticket }             │
  │                               │
  │◄─ presence.active ────────────┤
  │                               │
  │◄─ message.new ────────────────┤
  │◄─ message.ack ────────────────┤
  │◄─ typing.start ───────────────┤
  │◄─ typing.stop ────────────────┤
  │                               │
  ├─ typing.start ───────────────►│
  ├─ typing.stop ────────────────►│
  │                               │
```

### Backup Flow

```
Client                          Server                         R2 Storage
  │                               │                                │
  ├─ POST /backups/upload-url ───►│                                │
  │  { sizeBytes: 12345 }         │                                │
  │                               ├─ generate presigned URL ──────►│
  │◄─ { uploadUrl, bucketKey } ───┤                                │
  │                               │                                │
  ├─ PUT encrypted blob ──────────────────────────────────────────►│
  │                               │                                │
  ├─ PUT /backups/current ───────►│                                │
  │  { bucketKey, sha256, ... }   │◄─ verify object exists ────────┤
  │                               │                                │
  │◄─ 200 OK ─────────────────────┤                                │
  │                               │                                │
```

## Database Schema Overview

### Core Entities

- **User**: Identified by hashed phone number, status (ACTIVE/SUSPENDED), role (USER/MODERATOR/ADMIN), strike count.
- **Device**: Per-device identity with platform, push tokens, active state.
- **DirectThread**: Unique 1:1 conversation between two users.
- **Message**: Logical message with server-assigned thread sequence. Supports tombstone (`deletedAt`) and edit (`editedAt`) markers.
- **MessageEnvelope**: Per-device encrypted ciphertext with delivery status. `envelopeVersion` is bumped on each edit.
- **HiddenMessage**: Per-user local deletion record (delete for me).

### Cryptographic Entities

- **SignedPrekey**: Device's active signed prekey (rotated periodically).
- **OneTimePrekey**: Consumable prekeys for session initialization.

### Session Entities

- **RefreshToken**: Long-lived session tokens with rotation.
- **SocketTicket**: Single-use short-lived WebSocket auth tickets.

### Backup Entities

- **BackupBlob**: User's encrypted backup metadata (one per user).

### Moderation Entities

- **Report**: A user-filed report against a single message. `(reporterUserId, messageId)` is unique. Status state machine: `OPEN → IN_REVIEW → CLOSED`. Resolution is one of `DISMISSED` (manual), `AUTO_CLOSED_TOMBSTONED` (closed because the message was tombstoned), `AUTO_CLOSED_SUSPENDED` (closed because the sender was suspended).
- **UserSuspension**: One row per suspension. `expiresAt` is nullable (null = permanent). `revokedAt` is set when the suspension is lifted (manually by an admin, or automatically by the reactivation cron).
- **AdminAuditLog**: Append-only accountability surface. `actorUserId` is nullable (null for system actions like env-var bootstrap, CLI scripts, or auto-reactivation). The `metadata` JSONB column is for action-specific context (e.g. `previousCount` on `STRIKE_RESET`, `tombstonedMessageCount` on `USER_SUSPEND`). Pruned: **never**.
- **DailyMetric**: One row per `(date, kind, dimension)` tuple. Written by the daily rollup cron (00:30 UTC). Pruned after `DAILY_METRICS_RETENTION_DAYS` (default 365).

### Key Relationships

```
User (1) ──── (N) Device
Device (1) ──── (N) SignedPrekey
Device (1) ──── (N) OneTimePrekey
User (1) ──── (N) RefreshToken
User (1) ──── (1) BackupBlob
Device (1) ──── (N) SocketTicket

User (A) ──── (1) DirectThread ──── (1) User (B)
DirectThread (1) ──── (N) Message
Message (1) ──── (N) MessageEnvelope
MessageEnvelope (N) ──── (1) Device (recipient)
User (N) ──── (N) HiddenMessage

User (1) ──── (N) Report        (as reporter, via Report.reporterUserId)
Message (1) ──── (N) Report     (as target,   via Report.messageId)
User (1) ──── (N) UserSuspension (as target, as actor, as revoker)
User (1) ──── (N) AdminAuditLog  (as actor,   actorUserId nullable)
```

## Infrastructure Components

### PostgreSQL
- Primary data store via Prisma ORM
- ACID transactions for message sending and key operations
- Unique constraints for idempotency and thread ordering

### Redis
- Device-to-socket mapping for real-time routing
- Group member list cache for typing indicators (TTL 5 min)
- Ephemeral state for active connections
- Ping/pong health monitoring
- Connection resilience with exponential backoff retry strategy

### Cloudflare R2 (S3-Compatible)
- Encrypted backup blob storage
- Presigned URLs for direct client upload/download
- Automatic cleanup of old backup versions

### Firebase Cloud Messaging (FCM)
- Push notifications for message wakeups
- Silent notifications (content-available) for iOS
- Automatic stale token cleanup

## Security Architecture

### What the Server Knows
- User identities (phone number hashes)
- Device metadata (platform, last seen)
- Public key material (identity keys, prekeys)
- Message metadata (thread ID, sequence, timestamps)
- Encrypted ciphertext blobs (opaque JSON)

### What the Server Cannot Access
- Message content (encrypted client-side)
- Media content (encrypted client-side)
- Backup content (encrypted client-side)
- Private keys (never transmitted)
- Signal protocol session state

### Protection Mechanisms
- JWT access tokens with short TTL (15m default)
- Refresh token rotation (old token revoked on use)
- Single-use WebSocket tickets (60s TTL)
- Rate limiting (5 req/min for auth endpoints)
- Device ownership validation on all mutations
- Idempotent message sends prevent duplicates

## Event System

Internal events via `@nestjs/event-emitter`:

| Event | Payload | Emitted By | Handled By |
|-------|---------|------------|------------|
| `message.created` | Serialized message | MessagesService, GroupFanoutProcessor | RealtimeGateway |
| `message.ack` | ACK payload | MessagesService | RealtimeGateway |
| `message.deleted` | Delete payload | MessagesService | RealtimeGateway |
| `message.deleted.group` | Delete payload | MessagesService | RealtimeGateway |
| `message.edited` | Edit payload | MessagesService | RealtimeGateway |
| `message.edited.group` | Edit payload | MessagesService, GroupEditFanoutProcessor | RealtimeGateway |
| `message.tombstoned.platform` | Tombstone payload | ModerationService.tombstoneMessage | RealtimeGateway |

**Push Notification Decoupling**: `RealtimeGateway.onMessageCreated` emits Socket.IO events immediately and fires push notification wakeups asynchronously. Push delivery (FCM) does not block realtime delivery. Push fanout also filters `Device.user.status = 'ACTIVE'` so suspended recipients don't get wakeups for messages that were already in their mailbox.

**Cross-gateway suspension eviction**: when a user is suspended, `ModerationService.suspendUser` publishes a `realtime:user-kicked` message on Redis after committing the database transaction. Every gateway node subscribes via `redis.client.duplicate()` and on receipt: looks up local sockets for the affected user, emits `user.kicked` to them, and disconnects. This means a suspension on one node kicks the user on every node.

**Scheduled jobs** (`@nestjs/schedule`):

| Cron | Job | What it does |
|------|-----|--------------|
| `30 0 * * *` UTC | `DailyMetricsRollupService` | Roll up the previous UTC day into 7 `DailyMetric` rows (MESSAGES_SENT_DIRECT/GROUP, DAU, NEW_USERS, REPORTS_OPENED/RESOLVED, USERS_SUSPENDED). Idempotent on `(date, kind, dimension)`. |
| `45 0 * * *` UTC | `SuspensionReactivationService` | Find `UserSuspension` with `expiresAt < now AND revokedAt IS NULL`. For each: set `revokedAt = now`, flip `User.status = ACTIVE`, write `AdminAuditLog(USER_UNSUSPEND, actorUserId=null, metadata.source='auto-reactivation')`. Per-row try/catch so one bad row doesn't poison the batch. |
| `0 3 * * *` UTC | `PruneService` → `PruneProcessor` | Delete expired `RefreshToken`, consumed `SocketTicket`, used/expired `Otp`, old `SmsReport` (>30d), old `Report` (>REPORT_RETENTION_DAYS, default 365d), old `DailyMetric` (>DAILY_METRICS_RETENTION_DAYS, default 365d). **`AdminAuditLog` is never pruned.** |

External WebSocket events:

| Event | Direction | Description |
|-------|-----------|-------------|
| `message.new` | Server → Client | New encrypted envelope |
| `message.ack` | Server → Client | Delivery/read status update |
| `message.deleted` | Server → Client | Message tombstoned (sender or group admin) |
| `message.edited` | Server → Client | Message edited (new ciphertext available) |
| `message.tombstoned.platform` | Server → Client | Message tombstoned by a moderator/admin (not a self-delete) |
| `user.kicked` | Server → Client | Session forcibly terminated (e.g. on suspension) |
| `typing.start` | Bidirectional | User started typing |
| `typing.stop` | Bidirectional | User stopped typing |
| `presence.active` | Server → Client | User/device came online |

See [WebSocket Events Contract](./websocket-events.md) for full payloads.

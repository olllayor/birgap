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

## Module Architecture

```
src/
├── auth/              # Authentication (OTP, JWT, refresh tokens)
├── backups/           # Encrypted backup blob management
├── common/            # Shared utilities, guards, decorators, config
│   ├── config/        # Environment validation
│   ├── decorators/    # Custom decorators (@CurrentUser)
│   ├── filters/       # Exception filters
│   ├── guards/        # JWT auth guard
│   ├── types/         # TypeScript type definitions
│   └── utils/         # Crypto utilities
├── devices/           # Device registration and lifecycle
├── health/            # Health checks (Postgres, Redis)
├── messages/          # Message envelope relay and sequencing
├── prekeys/           # Cryptographic prekey management
├── prisma/            # Database service and schema
├── push/              # Push notification service (FCM)
├── realtime/          # WebSocket gateway and ticket auth
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
├── PrismaModule (database ORM)
├── RedisModule (caching layer)
├── AuthModule ─────────────────────────────────┐
├── UsersModule ────────────────────────────────┤
├── DevicesModule ──────────────────────────────┤
├── PreKeysModule ──────────────────────────────┤
├── MessagesModule ─────────────────────────────┤
├── RealtimeModule ─────────────────────────────┤
├── PushModule ─────────────────────────────────┤
├── BackupsModule ──────────────────────────────┤
├── StorageModule ──────────────────────────────┤
└── HealthModule ───────────────────────────────┘
```

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

### Message Send Flow

```
Sender Client                    Server                     Recipient Client
     │                              │                              │
     ├─ GET /users/:id/key-bundles ─►                              │
     │◄─ { devices: [key bundles] }─┤                              │
     │                              │                              │
     ├─ POST /messages ────────────►│                              │
     │  { envelopes: [...] }        │                              │
     │                              ├─ emit message.new ──────────►│
     │                              ├─ push notification ─────────►│
     │                              │                              │
     │◄─ 200 OK ────────────────────┤                              │
     │  { id, threadSequence }      │                              │
     │                              │                              │
     │                              │◄─ POST /messages/:id/ack ────┤
     │                              │   { status: "DELIVERED" }    │
     │◄─ emit message.ack ──────────┤                              │
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

- **User**: Identified by hashed phone number, status (ACTIVE/SUSPENDED)
- **Device**: Per-device identity with platform, push tokens, active state
- **DirectThread**: Unique 1:1 conversation between two users
- **Message**: Logical message with server-assigned thread sequence
- **MessageEnvelope**: Per-device encrypted ciphertext with delivery status

### Cryptographic Entities

- **SignedPrekey**: Device's active signed prekey (rotated periodically)
- **OneTimePrekey**: Consumable prekeys for session initialization

### Session Entities

- **RefreshToken**: Long-lived session tokens with rotation
- **SocketTicket**: Single-use short-lived WebSocket auth tickets

### Backup Entities

- **BackupBlob**: User's encrypted backup metadata (one per user)

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
```

## Infrastructure Components

### PostgreSQL
- Primary data store via Prisma ORM
- ACID transactions for message sending and key operations
- Unique constraints for idempotency and thread ordering

### Redis
- Device-to-socket mapping for real-time routing
- Ephemeral state for active connections
- Ping/pong health monitoring

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
| `message.created` | Serialized message | MessagesService | RealtimeGateway |
| `message.ack` | ACK payload | MessagesService | RealtimeGateway |

External WebSocket events:

| Event | Direction | Description |
|-------|-----------|-------------|
| `message.new` | Server → Client | New encrypted envelope |
| `message.ack` | Server → Client | Delivery/read status update |
| `typing.start` | Bidirectional | User started typing |
| `typing.stop` | Bidirectional | User stopped typing |
| `presence.active` | Server → Client | User/device came online |

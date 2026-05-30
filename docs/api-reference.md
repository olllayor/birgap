# API Reference

Base URL: `http://localhost:3000` (development)

All protected endpoints require JWT authentication via `Authorization: Bearer <accessToken>` header.

---

## Authentication

### Request OTP

Initiate authentication by requesting an OTP code.

```
POST /auth/otp/request
```

**Rate Limit**: 5 requests per 60 seconds

**Request Body**:
```json
{
  "phone": "+998901234567"
}
```

**Response** (202 Accepted):
```json
{
  "phone": "+99890****67",
  "mode": "sayqal",
  "success": true,
  "message": "OTP sent successfully",
  "expiresInSeconds": 300
}
```

**Cooldown Response** (202 Accepted):
```json
{
  "phone": "+99890****67",
  "mode": "sayqal",
  "success": true,
  "message": "OTP already sent. Please wait before requesting a new one.",
  "canResendAt": "2026-05-16T10:02:00.000Z"
}
```

**Notes**:
- OTP mode depends on `OTP_MODE` env var (`mock` or `sayqal`)
- In `mock` mode, OTP is logged to console (no SMS sent)
- In `sayqal` mode, OTP is sent via Sayqal SMS provider
- Phone number is normalized and hashed server-side
- Returns masked phone for user confirmation
- 2-minute cooldown between OTP requests per phone number

---

### Verify OTP

Verify the OTP code and receive authentication tokens.

```
POST /auth/otp/verify
```

**Rate Limit**: 5 requests per 60 seconds

**Request Body**:
```json
{
  "phone": "+998901234567",
  "code": "482193"
}
```

**Response** (200 OK):
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Error Response** (403 Forbidden):
```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "Invalid OTP code"
}
```

**Lockout Response** (403 Forbidden):
```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "Too many failed attempts. Please try again later."
}
```

**Expired Response** (404 Not Found):
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Invalid or expired OTP"
}
```

**Notes**:
- Creates user if phone number doesn't exist
- OTP codes are 6 digits, expire after 5 minutes (configurable)
- Maximum 5 failed attempts before 15-minute lockout
- Timing-safe comparison prevents timing attacks
- Refresh token is opaque (not JWT)

---

### Refresh Token

Exchange a refresh token for a new token pair.

```
POST /auth/refresh
```

**Request Body**:
```json
{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response** (200 OK):
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000"
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "f6e5d4c3b2a1..."
}
```

**Notes**:
- Old refresh token is **revoked** after use (rotation)
- New refresh token is issued
- If refresh token is expired or revoked, returns 401

---

### Logout

Revoke authentication tokens.

```
POST /auth/logout
```

**Authentication**: Required (JWT)

**Request Body** (optional):
```json
{
  "refreshToken": "a1b2c3d4e5f6..."
}
```

**Response**: 204 No Content

**Notes**:
- If `refreshToken` provided, revokes that specific token
- If not provided, revokes current session
- Returns 204 even if token already revoked

---

## Devices

### Register Device

Register a new device or reactivate an existing one.

```
POST /devices/register
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "deviceId": "optional-existing-uuid",
  "platform": "ANDROID",
  "displayName": "My Pixel 8",
  "identityPublicKey": "base64-encoded-identity-public-key",
  "pushToken": "optional-fcm-token",
  "pushPlatform": "FCM",
  "pushActive": true
}
```

**Response** (201 Created):
```json
{
  "id": "device-uuid",
  "platform": "ANDROID",
  "displayName": "My Pixel 8",
  "pushPlatform": "FCM",
  "pushActive": true,
  "lastSeenAt": "2026-05-16T10:00:00.000Z",
  "createdAt": "2026-05-16T10:00:00.000Z"
}
```

**Notes**:
- Maximum 3 active devices per user (configurable)
- If `deviceId` exists and belongs to user, reactivates it
- Returns 409 Conflict if max devices reached
- Allowed platforms: `ANDROID`, `IOS`, `WEB`
- Allowed push platforms: `FCM`, `APNS`, `HMS`

---

### List Devices

Get all active devices for the current user.

```
GET /devices
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
[
  {
    "id": "device-uuid-1",
    "platform": "ANDROID",
    "displayName": "My Pixel 8",
    "pushPlatform": "FCM",
    "pushActive": true,
    "lastSeenAt": "2026-05-16T10:00:00.000Z",
    "createdAt": "2026-05-16T10:00:00.000Z"
  },
  {
    "id": "device-uuid-2",
    "platform": "IOS",
    "displayName": "My iPhone",
    "pushPlatform": "APNS",
    "pushActive": true,
    "lastSeenAt": "2026-05-16T09:00:00.000Z",
    "createdAt": "2026-05-15T10:00:00.000Z"
  }
]
```

---

### Deactivate Device

Deactivate a device (soft delete).

```
DELETE /devices/:deviceId
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
{
  "id": "device-uuid",
  "active": false
}
```

**Notes**:
- Cannot deactivate another user's device
- Deactivated devices cannot receive messages or authenticate
- Returns 404 if device not found

---

## Prekeys

### Get Prekey Count

Check remaining prekeys for a device.

```
GET /devices/:deviceId/prekeys/count
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
{
  "deviceId": "device-uuid",
  "oneTimePrekeysRemaining": 45,
  "hasActiveSignedPrekey": true,
  "lowWatermark": false
}
```

**Notes**:
- `lowWatermark` is `true` when remaining prekeys < 10
- Client should refill prekeys when low watermark is reached

---

### Refill One-Time Prekeys

Upload new one-time prekeys for a device.

```
POST /devices/:deviceId/prekeys/refill
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "prekeys": [
    {
      "keyId": 101,
      "publicKey": "base64-encoded-public-key"
    },
    {
      "keyId": 102,
      "publicKey": "base64-encoded-public-key"
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "inserted": 2
}
```

**Notes**:
- Array length: 1-200
- `keyId` must be integer > 0
- Duplicate `(deviceId, keyId)` entries are skipped
- Returns count of actually inserted prekeys

---

### Rotate Signed Prekey

Rotate the active signed prekey for a device.

```
PUT /devices/:deviceId/signed-prekey
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "keyId": 10,
  "publicKey": "base64-encoded-public-key",
  "signature": "identity-key-signature-over-prekey"
}
```

**Response** (200 OK):
```json
{
  "id": "prekey-uuid",
  "deviceId": "device-uuid",
  "keyId": 10,
  "publicKey": "base64-encoded-public-key",
  "signature": "identity-key-signature-over-prekey",
  "active": true,
  "createdAt": "2026-05-16T10:00:00.000Z"
}
```

**Notes**:
- Existing active signed prekeys are marked inactive
- Recommended rotation interval: 7 days
- Signature must be verifiable with device's identity public key

---

## Users

### Get Device Key Bundles

Fetch all active devices and their key material for a user.

```
GET /users/:userId/devices/key-bundles
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
{
  "userId": "user-uuid",
  "devices": [
    {
      "deviceId": "device-uuid",
      "userId": "user-uuid",
      "platform": "ANDROID",
      "identityPublicKey": "base64-encoded-identity-public-key",
      "signedPrekey": {
        "id": "prekey-uuid",
        "keyId": 10,
        "publicKey": "base64-encoded-public-key",
        "signature": "signature",
        "createdAt": "2026-05-16T10:00:00.000Z"
      },
      "oneTimePrekey": {
        "keyId": 101,
        "publicKey": "base64-encoded-public-key"
      }
    }
  ]
}
```

**Notes**:
- Fetching a key bundle **consumes** one one-time prekey per device
- `oneTimePrekey` may be `null` if no prekeys available
- Client must support session initialization with `oneTimePrekey: null`
- Returns devices ordered by `createdAt` ascending

---

## Messages

### Send Message

Send an encrypted message with per-device envelopes.

```
POST /messages
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "senderDeviceId": "sender-device-uuid",
  "recipientUserId": "recipient-user-uuid",
  "idempotencyKey": "client-generated-unique-key",
  "envelopes": [
    {
      "recipientDeviceId": "recipient-device-uuid",
      "ciphertext": {
        "type": "signal-message",
        "body": "base64-ciphertext",
        "metadata": {
          "clientMessageId": "local-id"
        }
      }
    },
    {
      "recipientDeviceId": "sender-other-device-uuid",
      "ciphertext": {
        "type": "signal-message",
        "body": "base64-ciphertext"
      }
    }
  ]
}
```

**Response** (200 OK):
```json
{
  "id": "message-uuid",
  "threadId": "thread-uuid",
  "senderUserId": "sender-user-uuid",
  "senderDeviceId": "sender-device-uuid",
  "threadSequence": 1,
  "createdAt": "2026-05-16T10:00:00.000Z",
  "envelopes": [
    {
      "id": "envelope-uuid",
      "messageId": "message-uuid",
      "recipientUserId": "recipient-user-uuid",
      "recipientDeviceId": "recipient-device-uuid",
      "ciphertext": {
        "type": "signal-message",
        "body": "base64-ciphertext"
      },
      "status": "PENDING",
      "deliveredAt": null,
      "readAt": null,
      "createdAt": "2026-05-16T10:00:00.000Z"
    }
  ]
}
```

**Notes**:
- `idempotencyKey` is required (8-128 characters)
- Unique constraint: `(senderDeviceId, idempotencyKey)`
- Must include envelope for **every active recipient device**
- May include envelopes for sender's other devices (sync)
- Envelopes for unrelated devices are rejected
- Retrying with same idempotency key returns original message
- Server assigns `threadSequence` for ordering

**Errors**:
- 400: Missing envelope for recipient device
- 400: Envelope device not part of conversation
- 403: Sender device not active for user
- 404: Recipient has no active devices

---

### Fetch Pending Messages

Get pending and delivered-but-not-read envelopes for a device.

```
GET /messages/pending?deviceId=uuid&after=cursor&limit=50
```

**Authentication**: Required (JWT)

**Query Parameters**:
| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `deviceId` | Yes | - | Device UUID |
| `after` | No | - | Cursor from previous response |
| `limit` | No | 50 | Max envelopes (max 200) |

**Response** (200 OK):
```json
{
  "deviceId": "device-uuid",
  "hasMore": true,
  "envelopes": [
    {
      "id": "envelope-uuid",
      "messageId": "message-uuid",
      "recipientUserId": "user-uuid",
      "recipientDeviceId": "device-uuid",
      "ciphertext": {
        "type": "signal-message",
        "body": "base64-ciphertext"
      },
      "status": "PENDING",
      "deliveredAt": null,
      "readAt": null,
      "envelopeSequence": "142",
      "createdAt": "2026-05-16T10:00:00.000Z",
      "message": {
        "id": "message-uuid",
        "threadId": "thread-uuid",
        "senderUserId": "sender-user-uuid",
        "senderDeviceId": "sender-device-uuid",
        "threadSequence": 1,
        "createdAt": "2026-05-16T10:00:00.000Z"
      }
    }
  ]
}
```

**Notes**:
- Returns envelopes with status `PENDING` or `DELIVERED`
- Ordered by `envelopeSequence` (global insertion order)
- Use `hasMore` to paginate
- Use `envelopeSequence` as `after` cursor
- Use `threadSequence` for per-thread message ordering
- Call after login, WebSocket reconnect, or push wakeup

**Pagination Example**:
```typescript
let after: string | undefined;
do {
  const url = `/messages/pending?deviceId=${deviceId}${after ? `&after=${after}` : ''}&limit=50`;
  const resp = await fetch(url);
  const data = await resp.json();
  processEnvelopes(data.envelopes);
  after = data.hasMore ? data.envelopes[data.envelopes.length - 1].envelopeSequence : undefined;
} while (after);
```

---

### Acknowledge Message

Update delivery/read status for a message envelope.

```
POST /messages/:messageId/ack
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "deviceId": "recipient-device-uuid",
  "status": "DELIVERED"
}
```

**Response** (200 OK):
```json
{
  "id": "envelope-uuid",
  "messageId": "message-uuid",
  "recipientUserId": "user-uuid",
  "recipientDeviceId": "device-uuid",
  "status": "DELIVERED",
  "deliveredAt": "2026-05-16T10:00:00.000Z",
  "readAt": null,
  "createdAt": "2026-05-16T10:00:00.000Z"
}
```

**Notes**:
- Allowed statuses: `DELIVERED`, `READ`
- `READ` automatically sets `deliveredAt` if not set
- ACKs are per-device
- Sender receives `message.ack` WebSocket event

---

## Realtime

### Create WebSocket Ticket

Generate a single-use ticket for WebSocket authentication.

```
POST /realtime/token
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "deviceId": "current-device-uuid"
}
```

**Response** (200 OK):
```json
{
  "ticket": "single-use-ticket-string",
  "expiresAt": "2026-05-16T10:01:00.000Z"
}
```

**Notes**:
- Ticket TTL: 60 seconds (default)
- Single-use only
- If access token expired, refresh first
- Use ticket in Socket.IO `auth.ticket`

**WebSocket Connection**:
```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { ticket: 'single-use-ticket-string' },
  transports: ['websocket'],
});
```

---

## Backups

### Get Upload URL

Generate a presigned URL for uploading an encrypted backup blob.

```
POST /backups/upload-url
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "sizeBytes": 12345
}
```

**Response** (200 OK):
```json
{
  "uploadUrl": "https://r2.cloudflarestorage.com/...?X-Amz-...",
  "bucketKey": "backups/user-uuid/backup-uuid.bin",
  "method": "PUT"
}
```

**Notes**:
- Presigned URL TTL: 900 seconds (default)
- Upload directly to R2 (not through API)
- URL is single-use

---

### Upload Current Backup

Register an uploaded backup blob.

```
PUT /backups/current
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "version": 1,
  "bucketKey": "backups/user-uuid/backup-uuid.bin",
  "sha256": "hash-of-encrypted-blob",
  "sizeBytes": 12345
}
```

**Response** (200 OK):
```json
{
  "id": "backup-uuid",
  "version": 1,
  "sha256": "hash-of-encrypted-blob",
  "sizeBytes": 12345,
  "uploadedAt": "2026-05-16T10:00:00.000Z"
}
```

**Notes**:
- Verifies object exists in R2 before registering
- Upserts (replaces existing backup for user)
- Old backup deleted from R2 after new upload

---

### Download Current Backup

Get the current backup with a presigned download URL.

```
GET /backups/current
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
{
  "downloadUrl": "https://r2.cloudflarestorage.com/...?X-Amz-...",
  "sha256": "hash-of-encrypted-blob",
  "sizeBytes": 12345,
  "version": 1,
  "uploadedAt": "2026-05-16T10:00:00.000Z"
}
```

**Notes**:
- Presigned URL TTL: 300 seconds (default)
- Download directly from R2
- Verify SHA-256 after download

---

### Get Backup Metadata

Get backup metadata without download URL.

```
GET /backups/metadata
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
{
  "sha256": "hash-of-encrypted-blob",
  "sizeBytes": 12345,
  "version": 1,
  "uploadedAt": "2026-05-16T10:00:00.000Z"
}
```

**Notes**:
- Use to check if backup exists before downloading
- Lighter response than `GET /backups/current`

---

## Health

### Health Check

Check service health (no authentication required).

```
GET /health
```

**Response** (200 OK):
```json
{
  "status": "ok",
  "info": {
    "postgres": {
      "status": "up"
    },
    "redis": {
      "status": "up"
    }
  }
}
```

**Notes**:
- Checks PostgreSQL connectivity
- Checks Redis connectivity
- Returns 503 if any check fails

---

## Error Responses

All errors follow this format:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Missing envelope for active recipient device"
}
```

### Common Error Codes

| Code | Meaning | Example |
|------|---------|---------|
| 400 | Bad Request | Missing required field, invalid enum |
| 401 | Unauthorized | Invalid/expired token |
| 403 | Forbidden | Device belongs to another user |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Max devices reached |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |

---

## WebSocket Events

See [WebSocket Events Contract](./websocket-events.md) for complete event documentation.

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message.new` | Envelope object | New encrypted envelope |
| `message.ack` | ACK payload | Delivery/read status update |
| `typing.start` | `{ userId, deviceId, groupId? }` | User started typing |
| `typing.stop` | `{ userId, deviceId, groupId? }` | User stopped typing |
| `presence.active` | `{ userId, deviceId }` | User/device came online |

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `typing.start` | `{ recipientUserId }` | Start typing in 1:1 chat |
| `typing.stop` | `{ recipientUserId }` | Stop typing in 1:1 chat |
| `typing.start` | `{ groupId }` | Start typing in group chat |
| `typing.stop` | `{ groupId }` | Stop typing in group chat |

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
  "contentType": "TEXT | LOCATION | VENUE (optional, defaults to TEXT)",
  "replyToMessageId": "message-uuid (optional)",
  "mediaIds": ["media-uuid-1", "media-uuid-2"],
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
  "contentType": "TEXT",
  "replyToMessageId": null,
  "createdAt": "2026-05-16T10:00:00.000Z",
  "media": [
    {
      "id": "media-uuid-1",
      "messageId": "message-uuid",
      "mediaType": "IMAGE",
      "mimeType": "image/jpeg",
      "sizeBytes": 245678,
      "filename": "photo.jpg",
      "mediaCiphertextHash": "sha256...",
      "uploadStatus": "COMPLETE",
      "uploadedAt": "2026-05-16T09:59:55.000Z",
      "createdAt": "2026-05-16T09:59:50.000Z"
    }
  ],
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
- `contentType` is opaque to the server — it tags the message for local rendering hints (e.g. notification previews, thread list previews). The actual content (lat/lng, title, address) lives inside the encrypted `ciphertext` envelope as a client-defined plaintext JSON payload. Accepted values: `TEXT` (default), `LOCATION`, `VENUE`.
- `mediaIds` is optional (max 10 attachments per message, default `MEDIA_MAX_ATTACHMENTS_PER_MESSAGE=10`)
- Each `mediaId` must be owned by the sender, in `COMPLETE` status, and not yet bound to a message

**Errors**:
- 400: Missing envelope for recipient device
- 400: Envelope device not part of conversation
- 400: Too many attachments (exceeds `MEDIA_MAX_ATTACHMENTS_PER_MESSAGE`)
- 400: One or more mediaIds are invalid, already attached, or not yet fully uploaded
- 403: Sender device not active for user
- 404: Recipient has no active devices

---

### Forward Message

Forward an existing message to one or more targets (direct threads or groups). Media attachments are cloned server-side.

```
POST /messages/forward
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "sourceMessageId": "original-message-uuid",
  "senderDeviceId": "sender-device-uuid",
  "idempotencyKey": "client-generated-unique-key",
  "targets": [
    {
      "type": "direct",
      "recipientUserId": "recipient-user-uuid",
      "envelopes": [
        {
          "recipientDeviceId": "recipient-device-uuid",
          "ciphertext": {
            "type": "signal-message",
            "body": "base64-ciphertext"
          }
        }
      ]
    },
    {
      "type": "group",
      "groupId": "group-uuid",
      "ciphertext": {
        "type": "signal-group-message",
        "body": "base64-group-ciphertext"
      }
    }
  ]
}
```

**Field constraints**:
- `sourceMessageId`: UUID of a message the caller can access
- `senderDeviceId`: active device UUID for the current user
- `idempotencyKey`: 8–128 characters, unique per forward request
- `targets`: 1–20 items, each with `type` = `"direct"` or `"group"`
- Direct targets require `recipientUserId` + `envelopes` (one per active recipient device)
- Group targets require `groupId` + `ciphertext`

**Response** (200 OK):
```json
{
  "results": [
    {
      "targetType": "direct",
      "targetId": "recipient-user-uuid",
      "success": true,
      "messageId": "new-message-uuid"
    },
    {
      "targetType": "group",
      "targetId": "group-uuid",
      "success": false,
      "error": "You are not a member of this group"
    }
  ]
}
```

**Notes**:
- Each target is processed independently — partial failure is possible
- Cannot forward a deleted (tombstoned) message
- Forwarded messages are marked with `forwarded: true`
- The `contentType` of the source message (e.g. `LOCATION`, `VENUE`) is preserved on each forwarded message — recipients see the same content type tag as the original sender
- Media attachments are cloned server-side; recipients download via the normal `GET /messages/media/:mediaId/download-url` flow
- Per-target idempotency keys are derived internally (`{key}:0`, `{key}:1`, etc.)

**Errors**:
- 400: `sourceMessageId` is not a valid UUID
- 403: Caller cannot access the source message
- 403: Source message is deleted
- 403: Sender device is not active for the current user

---

## Media Attachments

The media flow has 3 steps per attachment: `init` → upload to R2 → `complete`. Attachments are bound to a message at `POST /messages` time (or `POST /groups/:id/envelopes`). Both endpoints also accept an optional `contentType` field (`TEXT` default, `LOCATION`, `VENUE`) which is stored on the `Message` row and preserved on forwarding — the actual content (e.g. coordinates, venue name) lives inside the encrypted `ciphertext` envelope and is opaque to the server.

### Init Media Upload

Create a pending `MessageMedia` row and get a presigned R2 upload URL for the encrypted blob.

```
POST /messages/media/init
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "mediaType": "IMAGE",
  "filename": "photo.jpg",
  "mimeType": "image/jpeg",
  "sizeBytes": 245678,
  "mediaCiphertextHash": "sha256-of-encrypted-blob",
  "width": 1920,
  "height": 1080
}
```

**Field constraints**:
- `mediaType`: one of `IMAGE`, `VIDEO`, `AUDIO`, `DOCUMENT`
- `sizeBytes`: 1 to 104857600 (100 MB)
- `mediaCiphertextHash`: 1-256 chars, server never decrypts

**Response** (201 Created):
```json
{
  "mediaId": "media-uuid",
  "uploadUrl": "https://r2.example.com/bucket/media/...?X-Amz-Signature=...",
  "bucketKey": "media/{userId}/{uuid}.jpg"
}
```

**Allowed mime types per `mediaType`**:
| `mediaType` | Allowed `mimeType` |
|---|---|
| `IMAGE` | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |
| `VIDEO` | `video/mp4`, `video/quicktime` |
| `AUDIO` | `audio/mpeg`, `audio/ogg`, `audio/aac`, `audio/mp4` |
| `DOCUMENT` | `application/pdf`, `text/plain` |

**Errors**:
- 400: `sizeBytes` exceeds 100 MB
- 400: `mimeType` not in the allowlist for the declared `mediaType`

---

### Complete Media Upload

Verify the R2 PUT succeeded with the expected size and flip the row to `COMPLETE`. Required before binding to a message.

```
POST /messages/media/:mediaId/complete
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "sizeBytes": 245678
}
```

**Response** (200 OK):
```json
{
  "id": "media-uuid",
  "bucketKey": "media/{userId}/{uuid}.jpg",
  "mediaType": "IMAGE",
  "mimeType": "image/jpeg",
  "sizeBytes": 245678
}
```

**Errors**:
- 400: Media is already `COMPLETE` or `FAILED`
- 400: Size mismatch — `HeadObject` returned a different `ContentLength` than `sizeBytes`
- 403: Caller is not the owner of the media
- 404: Media not found

---

### Get Media Download URL

Get a short-lived presigned R2 GET URL for an attachment. Caller must be a thread participant or group member of the parent message.

```
GET /messages/media/:mediaId/download-url
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
{
  "downloadUrl": "https://r2.example.com/bucket/media/...?X-Amz-Signature=...",
  "expiresIn": 300
}
```

**Errors**:
- 400: Media is not yet attached to a message
- 403: Media upload is not yet complete
- 403: Caller cannot access the parent message (not a thread participant or group member)
- 404: Media not found

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

### Delete Message

Delete a message. Supports two scopes: `FOR_ME` (local hide) and `FOR_EVERYONE` (tombstone).

```
DELETE /messages/:messageId
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "deviceId": "current-device-uuid",
  "scope": "FOR_ME"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "scope": "FOR_ME"
}
```

**Notes**:
- `FOR_ME`: Creates a `HiddenMessage` record for the current user. No realtime broadcast.
- `FOR_EVERYONE`: Sets `Message.deletedAt` tombstone. Emits `message.deleted` to all participants.
- Only the original sender can delete for everyone in direct threads.
- Group admins can delete any message in a group for everyone.
- `FOR_EVERYONE` is time-limited to 48 hours by default (configurable via `MESSAGE_EDIT_DELETE_LIMIT_HOURS`).
- After a tombstone, reactions and replies remain in the database; clients render a "Message deleted" placeholder.
- Admin deletions are audited in `MessageAdminDeleteLog`.

---

### Edit Message

Edit an existing direct message. Updates `Message.editedAt` and refreshes per-device envelope ciphertext.

```
PATCH /messages/:messageId
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "senderDeviceId": "sender-device-uuid",
  "idempotencyKey": "client-generated-edit-key",
  "envelopes": [
    {
      "recipientDeviceId": "recipient-device-uuid",
      "ciphertext": {
        "type": "signal-message",
        "body": "base64-updated-ciphertext"
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
  "editedAt": "2026-05-16T10:00:00.000Z",
  "createdAt": "2026-05-16T09:00:00.000Z"
}
```

**Notes**:
- Only the original sender can edit a message.
- Cannot edit a tombstoned (deleted) message.
- Edits are time-limited to 48 hours by default.
- `idempotencyKey` prevents duplicate edit fanouts on retries.
- Envelope `envelopeVersion` is incremented on each edit; `updatedAt` is refreshed.
- Emits `message.edited` to all thread participants.
- Silent push wakeup is sent to offline clients so they can sync the edit.

---

### Sync Updated Messages

Fetch message envelopes that have been edited or deleted since a given timestamp. Used for offline recovery when the client reconnects.

```
GET /messages/sync?deviceId=uuid&since=2026-05-16T10:00:00.000Z&limit=200
```

**Authentication**: Required (JWT)

**Query Parameters**:
| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `deviceId` | Yes | - | Device UUID |
| `since` | Yes | - | ISO 8601 timestamp |
| `limit` | No | 200 | Max envelopes (max 500) |

**Response** (200 OK):
```json
{
  "requiresFullReload": false,
  "envelopes": [
    {
      "id": "envelope-uuid",
      "messageId": "message-uuid",
      "recipientUserId": "user-uuid",
      "recipientDeviceId": "device-uuid",
      "ciphertext": { "type": "signal-message", "body": "base64-ciphertext" },
      "status": "PENDING",
      "envelopeVersion": 2,
      "updatedAt": "2026-05-16T10:00:00.000Z",
      "isEdit": true,
      "message": {
        "id": "message-uuid",
        "threadId": "thread-uuid",
        "groupId": null,
        "senderUserId": "sender-uuid",
        "senderDeviceId": "sender-device-uuid",
        "threadSequence": 1,
        "replyToMessageId": null,
        "createdAt": "2026-05-16T09:00:00.000Z",
        "deletedAt": null,
        "editedAt": "2026-05-16T10:00:00.000Z"
      }
    }
  ],
  "deletedMessages": [
    {
      "messageId": "message-uuid",
      "threadId": "thread-uuid",
      "groupId": null,
      "deletedAt": "2026-05-16T10:00:00.000Z"
    }
  ],
  "hasMore": false
}
```

**Notes**:
- If `since` is older than 14 days, returns `{ "requiresFullReload": true }`. Client should reload threads via GraphQL.
- `isEdit: true` when `envelopeVersion > 1` or the envelope was updated after the message was edited.
- `deletedMessages` contains tombstoned messages in threads/groups the user participates in.
- Call this endpoint after WebSocket reconnect or push wakeup.

---

## Reactions

### Toggle Reaction

Add or toggle a reaction on a message. Tapping the same emoji again removes it; tapping a different emoji replaces the previous reaction.

```
POST /messages/:messageId/reactions
```

**Authentication**: Required (JWT)

**Request Body**:
```json
{
  "emoji": "👍"
}
```

**Response** (200 OK):
```json
{
  "action": "added",
  "emoji": "👍"
}
```

**Toggle-off Response** (200 OK):
```json
{
  "action": "removed",
  "emoji": "👍"
}
```

**Allowed Emojis**: `👍`, `👎`, `❤️`, `🔥`, `😂`, `😮`, `😢`, `🎉`, `🙏`, `💯`, `👏`, `🤔`, `😍`, `🥳`, `😎`, `💪`, `✨`, `🚀`, `👀`, `💀`

**Notes**:
- One reaction per user per message
- Same emoji toggles off (removes)
- Different emoji replaces previous reaction
- Validates user is a participant (thread member or group member)
- Emits `reaction.new` or `reaction.removed` WebSocket event to other participants

**Errors**:
- 403: Not a participant in the conversation
- 404: Message not found

---

### Remove Reaction

Remove your reaction from a message (regardless of which emoji).

```
DELETE /messages/:messageId/reactions
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
{
  "removed": true
}
```

**No-op Response** (200 OK):
```json
{
  "removed": false
}
```

---

### Get Reaction Counts

Get aggregated reaction counts for a message.

```
GET /messages/:messageId/reactions
```

**Authentication**: Required (JWT)

**Response** (200 OK):
```json
[
  { "emoji": "👍", "count": 3, "reacted": true },
  { "emoji": "❤️", "count": 1, "reacted": false }
]
```

**Notes**:
- Returns aggregated counts grouped by emoji
- `reacted` indicates whether the current user used that emoji
- Results cached in Redis (5-minute TTL)
- Validates user is a participant

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

## Reports

User-facing endpoints for filing reports against a single message. See [Admin Endpoints](#admin) below for the moderator/admin queue.

### File a Report

```
POST /reports
```

**Authentication**: required (any role)

**Rate Limits** (USER only; MODERATOR and ADMIN are exempt):
- 50 reports per user per day (`REPORTS_DAILY_LIMIT`)
- 10 reports per client IP per minute (`REPORTS_PER_IP_PER_MINUTE`)

**Request Body**:
```json
{
  "messageId": "uuid",
  "reason": "SPAM",
  "freeText": "Repeated unwanted advertising"
}
```

`reason` must be one of: `SPAM`, `HARASSMENT`, `HATE_SPEECH`, `SEXUAL_CONTENT`, `VIOLENCE`, `IMPERSONATION`, `OTHER`.

**Response** (201 Created):
```json
{
  "id": "uuid",
  "reporterUserId": "uuid",
  "messageId": "uuid",
  "reason": "SPAM",
  "freeText": "Repeated unwanted advertising",
  "status": "OPEN",
  "resolution": null,
  "reviewedByUserId": null,
  "reviewedAt": null,
  "createdAt": "2026-06-06T12:00:00.000Z",
  "updatedAt": "2026-06-06T12:00:00.000Z"
}
```

**Error Responses**:
| Code | Reason |
|------|--------|
| 400 | Cannot report your own message; cannot report a deleted message |
| 403 | Suspended users cannot file reports; non-participant cannot report in a direct thread; non-member cannot report in a group |
| 404 | Message not found |
| 409 | Daily or per-IP rate limit reached |

**Notes**:
- Idempotent: filing against the same `(reporter, message)` returns the existing row, no double-counting.
- Free text is optional, max 2000 characters, stored verbatim.
- A "collusion counter" is incremented in Redis when many distinct users report the same message in a short window (default 10 within 1 hour). The counter is for ops; not surfaced to the reporter.

### List My Reports

```
GET /reports/mine
```

**Authentication**: required (any role)

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | int (1-100) | 20 | Max items to return |

**Response** (200 OK):
```json
{
  "id": "uuid",
  "reporterUserId": "uuid",
  "messageId": "uuid",
  "reason": "SPAM",
  "status": "OPEN",
  "resolution": null,
  "createdAt": "2026-06-06T12:00:00.000Z"
}
```

---

## Admin

Moderator and admin endpoints. All require JWT authentication. Each handler also enforces a role guard; lower-role callers receive `403 Forbidden`.

**Actor identity** is read from the JWT; the `user.role` is forwarded to service calls so the service can do extra cross-checks (e.g. "you cannot suspend an admin"). `ADMIN_PHONE_HASHES` (env var) or `pnpm admin:promote <phoneE164> --role <MODERATOR|ADMIN>` is how operators bootstrap the first admin.

### Identity

#### Get current admin actor

```
GET /admin/me
```

**Response** (200 OK):
```json
{ "userId": "uuid", "role": "ADMIN" }
```

### Report Queue (MODERATOR or ADMIN)

#### List report queue

```
GET /admin/reports
```

**Query Parameters** (`ListReportsQueryDto`):
| Param | Type | Description |
|-------|------|-------------|
| `status` | enum: `OPEN`, `IN_REVIEW`, `CLOSED` | Filter by report status |
| `reason` | enum: `SPAM`, `HARASSMENT`, ... | Filter by report reason |
| `limit` | int (1-100) | Max items to return (default 20) |
| `cursor` | string | Cursor for pagination |

**Response** (200 OK): array of `{ items, nextCursor }`. Each report includes a `reporter` projection and a `message` projection (id, senderUserId, threadId, groupId, createdAt, deletedAt) — **never the ciphertext**.

#### Get one report

```
GET /admin/reports/:reportId
```

**Response** (200 OK): full report row + reporter + message projection.

#### Mark report in review

```
POST /admin/reports/:reportId/review
```

**Side effects**: sets `status = IN_REVIEW`, writes `AdminAuditLog(REPORT_REVIEW_START)`. Idempotent.

#### Dismiss report

```
POST /admin/reports/:reportId/dismiss
```

**Request Body**:
```json
{ "reason": "Not a violation" }
```

**Side effects**: sets `status = CLOSED`, `resolution = DISMISSED`, writes `AdminAuditLog(REPORT_DISMISS, reason)`.

### Messages (MODERATOR or ADMIN; untombstone is ADMIN-only)

#### Tombstone a message

```
POST /admin/messages/:messageId/tombstone
```

**Request Body**:
```json
{
  "reason": "Child sexual abuse material",
  "reportId": "uuid"
}
```

`reportId` is optional. If supplied, that report is cascade-closed in the same transaction. Otherwise, every open report on the message is closed with `resolution = AUTO_CLOSED_TOMBSTONED`.

**Side effects** (all in one transaction):
- `Message.deletedAt = now()`
- Cascade-close open reports
- `AdminAuditLog(MESSAGE_TOMBSTONE, metadata.scope='platform')`
- After commit: emit `message.tombstoned.platform` WebSocket event to participants / group members

#### Untombsone a message (ADMIN only)

```
POST /admin/messages/:messageId/untombstone
```

**Request Body**:
```json
{ "reason": "Reversal on appeal" }
```

**Side effects**: `Message.deletedAt = null`, `AdminAuditLog(MESSAGE_UNTOMBSTONE)`.

### Users (ADMIN only)

#### Get user detail

```
GET /admin/users/:userId
```

**Response** (200 OK):
```json
{
  "user": {
    "id": "uuid",
    "phoneHash": "...",
    "phoneMasked": "+90***1234",
    "username": "alice",
    "profileAvatarUrl": null,
    "status": "ACTIVE",
    "role": "USER",
    "strikeCount": 0,
    "lastStrikeAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "filedReports": [ /* up to 25 */ ],
  "receivedReports": [ /* up to 25 */ ],
  "suspensions": [ /* up to 25, newest first */ ]
}
```

#### Search users

```
GET /admin/users
```

**Query Parameters**:
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Case-insensitive substring on `username`; also matches `phoneMasked` |
| `role` | enum: `USER`, `MODERATOR`, `ADMIN` | Filter by role |
| `status` | enum: `ACTIVE`, `SUSPENDED` | Filter by status |
| `limit` | int (1-100) | Max items to return (default 20) |

Results are ordered by `strikeCount DESC, createdAt DESC` so repeat offenders surface first.

#### Suspend a user

```
POST /admin/users/:userId/suspend
```

**Request Body**:
```json
{
  "reason": "Repeated harassment",
  "expiresAt": "2026-07-06T00:00:00.000Z",
  "reportId": "uuid"
}
```

`expiresAt` is optional; omit for a permanent suspension. `reportId` is optional; if supplied, that report is cascade-closed in the same transaction.

**Side effects** (all in one transaction):
- Insert `UserSuspension` row
- Set `User.status = SUSPENDED`, `User.strikeCount += 1`, `User.lastStrikeAt = now()`
- Revoke all of the user's unexpired `RefreshToken` rows
- Tombstone all of the user's non-deleted `Message` rows, cascade-close their open reports
- `AdminAuditLog(USER_SUSPEND, metadata.expiresAt, metadata.tombstonedMessageCount, ...)`
- After commit: publish `realtime:user-kicked` on Redis → all gateway nodes disconnect the user

**Error Responses**:
| Code | Reason |
|------|--------|
| 400 | `expiresAt` is in the past |
| 403 | Trying to suspend an admin, or yourself |
| 404 | User not found |
| 409 | User is already suspended |

#### Unsuspend a user

```
POST /admin/users/:userId/unsuspend
```

**Request Body**:
```json
{ "reason": "Appeal granted" }
```

**Side effects**: `UserSuspension.revokedAt = now`, `User.status = ACTIVE`, `AdminAuditLog(USER_UNSUSPEND)`. **Strikes are NOT decremented** — a strike is a permanent record of a past violation, not a current one. Auto-reactivation does the same thing automatically when `expiresAt` is in the past.

#### List suspension history

```
GET /admin/users/:userId/suspensions
```

**Response** (200 OK): array of `UserSuspension` rows, newest first, with `suspendedBy` and `revokedBy` projections.

#### Change user role

```
PATCH /admin/users/:userId/role
```

**Request Body**:
```json
{ "role": "MODERATOR", "reason": "Need help with triage" }
```

**Side effects**: `User.role = <new>`, `AdminAuditLog(ROLE_PROMOTE or ROLE_DEMOTE, metadata.from, metadata.to)`. Cannot promote a suspended user.

#### Reset strikes

```
POST /admin/users/:userId/strikes/reset
```

**Request Body**:
```json
{ "reason": "Confirmed false positive suspension on 2026-05-12" }
```

**Side effects**: `User.strikeCount = 0`, `User.lastStrikeAt = null`, `AdminAuditLog(STRIKE_RESET, metadata.previousCount)`.

### Analytics (MODERATOR or ADMIN; rollup is ADMIN-only)

#### Get time series

```
GET /admin/analytics
```

**Query Parameters** (`AnalyticsQueryDto`):
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `kind` | enum: `MESSAGES_SENT_DIRECT`, `MESSAGES_SENT_GROUP`, `DAU`, `NEW_USERS`, `REPORTS_OPENED`, `REPORTS_RESOLVED`, `USERS_SUSPENDED` | required | Which metric to read |
| `from` | ISO date (YYYY-MM-DD) | 30 days ago | Inclusive start |
| `to` | ISO date (YYYY-MM-DD) | today (UTC) | Inclusive end |
| `days` | int (1-366) | 30 | Window size when `from` not given |
| `dimension` | string (max 64) | none | Optional dimension filter (e.g. `DIRECT` / `GROUP`) |

**Response** (200 OK):
```json
{
  "kind": "DAU",
  "dimension": null,
  "from": "2026-05-07",
  "to": "2026-06-06",
  "series": [
    { "date": "2026-05-07", "value": 1234 },
    { "date": "2026-05-08", "value": 1301 }
  ]
}
```

**Notes**: rows are written by the daily rollup cron (00:30 UTC) which is idempotent on `(date, kind, dimension)`. Until a day has been rolled up, the series has a gap — backfill with the manual endpoint below.

#### Manual rollup (ADMIN only)

```
POST /admin/analytics/rollup
```

**Request Body**:
```json
{ "date": "2026-06-01" }
```

Re-runs the rollup for the given UTC day. Idempotent: re-running for the same day overwrites the values. Each call writes `AdminAuditLog(METRICS_ROLLUP, metadata.date, metadata.written)`.

### Audit Log (ADMIN only)

#### List audit log

```
GET /admin/audit-log
```

**Query Parameters** (`ListAuditLogQueryDto`):
| Param | Type | Description |
|-------|------|-------------|
| `action` | enum: `MESSAGE_TOMBSTONE`, `MESSAGE_UNTOMBSTONE`, `USER_SUSPEND`, `USER_UNSUSPEND`, `REPORT_DISMISS`, `REPORT_REVIEW_START`, `ROLE_PROMOTE`, `ROLE_DEMOTE`, `METRICS_ROLLUP`, `STRIKE_RESET` | Filter by action |
| `targetType` | enum: `MESSAGE`, `USER`, `REPORT` | Filter by target type |
| `actorUserId` | uuid | Filter by actor |
| `targetId` | uuid | Filter by target |
| `from` / `to` | ISO 8601 | Date range (inclusive) |
| `searchText` | string (≥ 3 chars) | Case-insensitive substring match on `reason` |
| `cursor` | string | Cursor for pagination |
| `limit` | int (1-100, default 50) | Max items to return |

**Response** (200 OK): array of `{ items, nextCursor }`. Each row:
```json
{
  "id": "uuid",
  "actorUserId": "uuid | null",
  "action": "USER_SUSPEND",
  "targetType": "USER",
  "targetId": "uuid",
  "reason": "Repeated harassment",
  "metadata": { "suspensionId": "uuid", "expiresAt": null, "tombstonedMessageCount": 12 },
  "createdAt": "2026-06-06T12:00:00.000Z"
}
```

`actorUserId` is `null` for system actions (env-var bootstrap, CLI scripts, auto-reactivation).

**Notes**:
- The audit log is **append-only**; there is no `PATCH` or `DELETE` endpoint.
- The audit log is **never pruned** by the daily cron. Enforce `REVOKE UPDATE, DELETE ON "AdminAuditLog"` from the app DB role out of band.

---

## Account Suspension Response Shape

When a request hits a suspended user, the server returns `403 Forbidden` with this body (so the client can show a meaningful UI):

```json
{
  "statusCode": 403,
  "error": "ACCOUNT_SUSPENDED",
  "message": "Your account is suspended",
  "reason": "Repeated harassment",
  "suspendedAt": "2026-06-01T00:00:00.000Z",
  "expiresAt": "2026-07-01T00:00:00.000Z",
  "appealUrl": "https://example.com/appeal"
}
```

`expiresAt` is `null` for permanent suspensions. `appealUrl` comes from the `SUSPENSION_APPEAL_URL` env var (omit for production deployment you control).

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
| 403 | Forbidden | Device belongs to another user; `ACCOUNT_SUSPENDED` (see above) |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Max devices reached; report rate limit reached |
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
| `reaction.new` | `{ reactionId, messageId, userId, emoji, createdAt, threadId, groupId }` | Reaction added |
| `reaction.removed` | `{ reactionId, messageId, userId, emoji, threadId, groupId }` | Reaction removed |

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `typing.start` | `{ recipientUserId }` | Start typing in 1:1 chat |
| `typing.stop` | `{ recipientUserId }` | Stop typing in 1:1 chat |
| `typing.start` | `{ groupId }` | Start typing in group chat |
| `typing.stop` | `{ groupId }` | Stop typing in group chat |

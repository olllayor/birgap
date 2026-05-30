# BirGap Mobile API Integration Guide

This guide is for the Flutter mobile client. The backend is an E2EE-ready relay: it stores public key material and opaque encrypted payloads only. The mobile app must generate keys, encrypt messages, decrypt messages, and encrypt backups locally.

Base URL in local development: `http://localhost:3000`

OpenAPI docs: `http://localhost:3000/docs`

## Auth Flow

Authentication uses OTP verification via SMS (Sayqal provider) or mock mode for development.

### OTP Behavior

| Mode | Description |
|------|-------------|
| `mock` | OTP code logged to server console, no SMS sent |
| `sayqal` | OTP sent via Sayqal SMS gateway |

Switch modes via `OTP_MODE` env variable.

### Request OTP

`POST /auth/otp/request`

```json
{
  "phone": "+998901112233"
}
```

Returns `202 Accepted`.

```json
{
  "phone": "+99890****33",
  "mode": "sayqal",
  "success": true,
  "message": "OTP sent successfully",
  "expiresInSeconds": 300
}
```

**Cooldown response** (if requested too soon):

```json
{
  "phone": "+99890****33",
  "mode": "sayqal",
  "success": true,
  "message": "OTP already sent. Please wait before requesting a new one.",
  "canResendAt": "2026-05-16T10:02:00.000Z"
}
```

Rules:
- 2-minute cooldown between OTP requests per phone number
- OTP codes are 6 digits
- Codes expire after 5 minutes (configurable via `OTP_TTL_SECONDS`)

### Verify OTP

`POST /auth/otp/verify`

```json
{
  "phone": "+998901112233",
  "code": "482193"
}
```

Returns:

```json
{
  "user": {
    "id": "user-uuid"
  },
  "accessToken": "jwt",
  "refreshToken": "opaque-refresh-token"
}
```

**Error responses**:

| Code | Message | Meaning |
|------|---------|---------|
| 403 | `Invalid OTP code` | Wrong code, attempt counted |
| 403 | `Too many failed attempts. Please try again later.` | Locked out (5 failed attempts) |
| 404 | `Invalid or expired OTP` | No valid OTP found or expired |

Rules:
- Maximum 5 failed attempts per OTP
- 15-minute lockout after max attempts
- Timing-safe comparison used (no timing attacks)

Use the access token for protected REST endpoints:

```http
Authorization: Bearer <accessToken>
```

### Refresh Token

`POST /auth/refresh`

```json
{
  "refreshToken": "opaque-refresh-token"
}
```

Returns a new access token and refresh token. The old refresh token is revoked.

### Logout

`POST /auth/logout`

Protected endpoint. Optional body:

```json
{
  "refreshToken": "opaque-refresh-token"
}
```

If no refresh token is provided, the current session is revoked.

## Devices

Each user can have up to 3 active devices. Every device has its own identity public key, signed prekey, one-time prekeys, and push token.

### Register Device

`POST /devices/register`

Protected endpoint.

```json
{
  "deviceId": "optional-existing-device-uuid",
  "platform": "ANDROID",
  "displayName": "Ollayor Pixel",
  "identityPublicKey": "client-generated-identity-public-key",
  "pushToken": "optional-fcm-or-apns-token",
  "pushPlatform": "FCM",
  "pushActive": true
}
```

Allowed platforms:

- `ANDROID`
- `IOS`
- `WEB`

Allowed push platforms:

- `FCM`
- `APNS`
- `HMS`

If the user already has 3 active devices, registration returns `409 Conflict`. The app should show a device-management flow and call `DELETE /devices/:deviceId` for an old device before retrying.

### List Devices

`GET /devices`

Protected endpoint. Lists the current user’s active devices.

### Deactivate Device

`DELETE /devices/:deviceId`

Protected endpoint. Deactivates one current-user device. Deactivated devices cannot use pending sync or socket auth.

## Prekeys

Prekeys let another user start an encrypted session with one of this user’s devices.

Mobile responsibilities:

- Generate one identity key pair per device.
- Generate one active signed prekey per device.
- Generate a pool of one-time prekeys per device.
- Upload only public key material.
- Keep private keys only on-device.

### Refill One-Time Prekeys

`POST /devices/:deviceId/prekeys/refill`

Protected endpoint. Device must belong to the current user.

```json
{
  "prekeys": [
    {
      "keyId": 1,
      "publicKey": "one-time-prekey-public-key-1"
    },
    {
      "keyId": 2,
      "publicKey": "one-time-prekey-public-key-2"
    }
  ]
}
```

Rules:

- `prekeys` length: `1..200`
- `keyId`: integer greater than 0
- duplicate `(deviceId, keyId)` entries are skipped

Returns:

```json
{
  "inserted": 2
}
```

### Rotate Signed Prekey

`PUT /devices/:deviceId/signed-prekey`

Protected endpoint. Device must belong to the current user.

```json
{
  "keyId": 10,
  "publicKey": "signed-prekey-public-key",
  "signature": "identity-key-signature-over-signed-prekey"
}
```

Behavior:

- Existing active signed prekeys for the device are marked inactive.
- The submitted signed prekey becomes active.
- Mobile should rotate signed prekeys on a timer, default every 7 days.

### Fetch Recipient Key Bundles

`GET /users/:userId/devices/key-bundles`

Protected endpoint. Returns key bundles for all active devices of the recipient.

Example response:

```json
{
  "userId": "recipient-user-uuid",
  "devices": [
    {
      "deviceId": "recipient-device-uuid",
      "userId": "recipient-user-uuid",
      "platform": "ANDROID",
      "identityPublicKey": "recipient-device-identity-public-key",
      "signedPrekey": {
        "id": "signed-prekey-row-uuid",
        "keyId": 10,
        "publicKey": "signed-prekey-public-key",
        "signature": "signature",
        "createdAt": "2026-05-10T12:00:00.000Z"
      },
      "oneTimePrekey": {
        "keyId": 101,
        "publicKey": "one-time-prekey-public-key"
      }
    }
  ]
}
```

Important fallback:

```json
{
  "oneTimePrekey": null
}
```

If a device has no unused one-time prekeys left, the backend still returns identity key and signed prekey. The mobile app must support session initialization with `oneTimePrekey: null`.

Fetching a key bundle consumes one available one-time prekey for each recipient device.

## Messages

The backend stores logical messages and per-device encrypted envelopes.

Mobile responsibilities:

- Fetch recipient key bundles before first send.
- Create a separate ciphertext envelope for each active recipient device.
- Create sender-sync envelopes for the sender’s other active devices if the app wants multi-device sync.
- Generate a required `idempotencyKey` for every outgoing logical message.
- Treat `ciphertext` as app-defined encrypted JSON. The backend does not inspect it.

### Send Message

`POST /messages`

Protected endpoint.

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
          "clientMessageId": "local-client-message-id"
        }
      }
    }
  ]
}
```

Rules:

- `idempotencyKey` is required, length `8..128`.
- Unique constraint is `(senderDeviceId, idempotencyKey)`.
- Retrying the same request with the same idempotency key returns the same server message.
- The request must include envelopes for every active recipient device.
- Envelopes may also include the sender’s other active devices for sender-sync.
- Envelopes for unrelated devices are rejected.

Response:

```json
{
  "id": "message-uuid",
  "threadId": "direct-thread-uuid",
  "senderUserId": "sender-user-uuid",
  "senderDeviceId": "sender-device-uuid",
  "threadSequence": 1,
  "createdAt": "2026-05-10T12:00:00.000Z",
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
      "createdAt": "2026-05-10T12:00:00.000Z"
    }
  ]
}
```

Use `threadSequence` for final message ordering inside a direct chat. The client can show temporary local ordering while sending, then reconcile when the server response arrives.

### Fetch Pending Messages

`GET /messages/pending?deviceId=<device-uuid>&after=<cursor>&limit=50`

Protected endpoint. Device must belong to the current user.

Query parameters:
- `deviceId` (required): The device UUID
- `after` (optional): Cursor from a previous response. Omit to fetch from the beginning.
- `limit` (optional, default 50, max 200): Max envelopes per page

Returns pending and delivered-but-not-read envelopes for one device, ordered by `envelopeSequence` (global insertion order). The response includes `hasMore` to indicate whether another page exists.

```json
{
  "deviceId": "device-uuid",
  "hasMore": true,
  "envelopes": [
    {
      "id": "envelope-uuid",
      "messageId": "message-uuid",
      "recipientUserId": "current-user-uuid",
      "recipientDeviceId": "device-uuid",
      "ciphertext": {
        "type": "signal-message",
        "body": "base64-ciphertext"
      },
      "status": "PENDING",
      "deliveredAt": null,
      "readAt": null,
      "envelopeSequence": "142",
      "createdAt": "2026-05-10T12:00:00.000Z",
      "message": {
        "id": "message-uuid",
        "threadId": "direct-thread-uuid",
        "senderUserId": "sender-user-uuid",
        "senderDeviceId": "sender-device-uuid",
        "threadSequence": 1,
        "createdAt": "2026-05-10T12:00:00.000Z"
      }
    }
  ]
}
```

Call this after login, after WebSocket reconnect, and after receiving a push wakeup. Loop until `hasMore` is false:

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

Use `threadSequence` for per-thread message ordering in the UI. `envelopeSequence` is only for sync pagination.

### Acknowledge Message

`POST /messages/:messageId/ack`

Protected endpoint.

```json
{
  "deviceId": "recipient-device-uuid",
  "status": "DELIVERED"
}
```

Allowed statuses:

- `DELIVERED`
- `READ`

Behavior:

- `READ` also ensures `deliveredAt` is set.
- ACKs are per recipient device.
- The sender receives a realtime `message.ack` event if connected.

## Realtime

Realtime uses Socket.IO. The socket does not use the REST access token directly. First exchange the REST token for a short-lived single-use socket ticket.

### Create WebSocket Ticket

`POST /realtime/token`

Protected endpoint.

```json
{
  "deviceId": "current-device-uuid"
}
```

Response:

```json
{
  "ticket": "single-use-ticket",
  "expiresAt": "2026-05-10T12:01:00.000Z"
}
```

Rules:

- Ticket TTL defaults to 60 seconds.
- Ticket is single-use.
- If the REST access token is expired, refresh it first, then request a socket ticket.

### Connect Socket.IO

```ts
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  auth: { ticket },
  transports: ["websocket"]
});
```

The backend also accepts `?ticket=...`, but `auth.ticket` is preferred.

Server ping interval is 25 seconds.

### Server Events

#### `message.new`

Sent to the recipient device room when a new encrypted envelope is created.

Payload is the envelope for this device:

```json
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
  "createdAt": "2026-05-10T12:00:00.000Z"
}
```

Recommended client behavior:

1. Decrypt locally.
2. Store locally.
3. Send `DELIVERED` ACK.
4. Later send `READ` ACK when the user opens/views it.

#### `message.ack`

Sent to the sender’s user room when a recipient device ACKs.

```json
{
  "messageId": "message-uuid",
  "deviceId": "recipient-device-uuid",
  "userId": "recipient-user-uuid",
  "status": "DELIVERED",
  "threadId": "direct-thread-uuid",
  "threadSequence": 1,
  "senderUserId": "sender-user-uuid",
  "senderDeviceId": "sender-device-uuid"
}
```

#### `typing.start` (Direct)

```json
{
  "userId": "typing-user-uuid",
  "deviceId": "typing-device-uuid"
}
```

#### `typing.stop` (Direct)

```json
{
  "userId": "typing-user-uuid",
  "deviceId": "typing-device-uuid"
}
```

#### `typing.start` (Group)

```json
{
  "userId": "typing-user-uuid",
  "deviceId": "typing-device-uuid",
  "groupId": "group-uuid"
}
```

#### `typing.stop` (Group)

```json
{
  "userId": "typing-user-uuid",
  "deviceId": "typing-device-uuid",
  "groupId": "group-uuid"
}
```

#### `presence.active`

```json
{
  "userId": "active-user-uuid",
  "deviceId": "active-device-uuid"
}
```

### Client Events

#### `typing.start` (Direct)

```json
{
  "recipientUserId": "other-user-uuid"
}
```

#### `typing.stop` (Direct)

```json
{
  "recipientUserId": "other-user-uuid"
}
```

#### `typing.start` (Group)

```json
{
  "groupId": "group-uuid"
}
```

#### `typing.stop` (Group)

```json
{
  "groupId": "group-uuid"
}
```

Typing events are not stored. The UI should auto-expire typing state after 3 seconds if no new typing event arrives.

## Backups

Backups are opaque encrypted blobs. The backend cannot read them.

Mobile responsibilities:

- Export local chat state.
- Encrypt it locally with a user secret or password-derived key.
- Upload encrypted blob only.
- Decrypt locally during restore.

### Upload Current Backup

`PUT /backups/current`

Protected endpoint.

```json
{
  "version": 1,
  "blob": "base64-encrypted-backup-blob",
  "checksum": "sha256-or-client-defined-checksum"
}
```

Response:

```json
{
  "id": "backup-row-uuid",
  "version": 1,
  "checksum": "sha256-or-client-defined-checksum",
  "sizeBytes": 12345,
  "updatedAt": "2026-05-10T12:00:00.000Z"
}
```

### Download Current Backup

`GET /backups/current`

Protected endpoint. Returns the stored opaque blob and metadata.

### Get Backup Metadata

`GET /backups/metadata`

Protected endpoint.

```json
{
  "id": "backup-row-uuid",
  "version": 1,
  "checksum": "sha256-or-client-defined-checksum",
  "sizeBytes": 12345,
  "createdAt": "2026-05-10T12:00:00.000Z",
  "updatedAt": "2026-05-10T12:00:00.000Z"
}
```

Use metadata to decide whether restore/download is needed before fetching the full blob.

## Health

### Health Check

`GET /health`

No auth required.

```json
{
  "status": "ok",
  "timestamp": "2026-05-10T12:00:00.000Z"
}
```

Mobile can use this for simple API reachability checks during development.

## SMS Provider

The backend supports two OTP delivery modes:

### Sayqal SMS Provider

Production SMS delivery via Sayqal gateway (`https://sayqal.uz/api`).

**Authentication**: MD5-based token generated per request:
```
X-Access-Token = MD5("{endpoint} {username} {secret} {utime}")
```

**Endpoints used**:
- `TransmitSMS` — sends OTP or regular messages
- `DetalSMS` — checks delivery status (internal use)

**Service types**:
- `2` — OTP verification codes
- `4` — Regular messages

### Mock SMS Provider

Development mode. OTP codes are logged to server console instead of sending SMS.

### Switching Providers

Set `OTP_MODE` environment variable:
- `mock` — use mock provider (default)
- `sayqal` — use Sayqal SMS provider

Every SMS attempt is logged to the `SmsReport` table with provider, success status, and any errors.

## Recommended Mobile Startup Sequence

1. Request and verify OTP.
2. Store `accessToken`, `refreshToken`, and `user.id`.
3. Generate device identity key if this is a new install.
4. Register device via `POST /devices/register`.
5. Upload signed prekey via `PUT /devices/:deviceId/signed-prekey`.
6. Upload one-time prekeys via `POST /devices/:deviceId/prekeys/refill`.
7. Create realtime ticket via `POST /realtime/token`.
8. Connect Socket.IO with `auth.ticket`.
9. Call `GET /messages/pending?deviceId=...`.
10. For every pending/new envelope: decrypt, store locally, ACK delivered.

## Recommended Send Message Sequence

1. Fetch recipient bundles from `GET /users/:recipientUserId/devices/key-bundles`.
2. For every recipient device, create or reuse a Signal session.
3. Encrypt the message separately per recipient device.
4. Add sender-sync envelopes for the sender’s other devices if supported.
5. Generate a stable `idempotencyKey`.
6. `POST /messages`.
7. Reconcile local pending message with returned `id` and `threadSequence`.

## Error Handling Expectations

- `401`: access token missing/expired/invalid. Refresh token and retry once.
- `403`: device does not belong to current user, session is revoked, or account suspended. Stop using that device/session.
- `403`: OTP verification failed too many times. Wait for lockout to expire.
- `404`: target resource does not exist or is not available to this user.
- `409`: max active devices reached. Show device removal UI.
- `400`: malformed request, missing envelopes, invalid ACK status, or invalid recipient.

## Security Rules For Mobile

- Never send plaintext message bodies to the backend.
- Never send private keys to the backend.
- Never put message text into push notification payload assumptions.
- Treat `identityPublicKey` changes as safety-number changes.
- Support `oneTimePrekey: null`.
- Use `idempotencyKey` for every send retry.
- Use `threadSequence` for final chat ordering.
- Always pending-sync after reconnect or push wakeup.

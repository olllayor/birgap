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

| Endpoint | Auth Required | Device Validation |
|----------|---------------|-------------------|
| `POST /auth/otp/request` | No | No |
| `POST /auth/otp/verify` | No | No |
| `POST /auth/refresh` | No (uses refresh token) | No |
| `POST /auth/logout` | Yes (JWT) | Current session |
| `POST /devices/register` | Yes (JWT) | User owns device |
| `GET /devices` | Yes (JWT) | Current user only |
| `DELETE /devices/:id` | Yes (JWT) | User owns device |
| `POST /devices/:id/prekeys/refill` | Yes (JWT) | User owns device |
| `PUT /devices/:id/signed-prekey` | Yes (JWT) | User owns device |
| `GET /users/:id/key-bundles` | Yes (JWT) | Any user |
| `POST /messages` | Yes (JWT) | Sender device owned |
| `GET /messages/pending` | Yes (JWT) | Device owned by user |
| `POST /messages/:id/ack` | Yes (JWT) | Device owned by user |
| `POST /realtime/token` | Yes (JWT) | Device owned by user |
| `PUT /backups/current` | Yes (JWT) | Current user only |
| `GET /backups/current` | Yes (JWT) | Current user only |
| `GET /health` | No | No |

## Rate Limiting

| Scope | Limit | Window | Purpose |
|-------|-------|--------|---------|
| Default | 60 requests | 60 seconds | General API protection |
| Auth | 5 requests | 60 seconds | OTP brute-force prevention |
| OTP cooldown | 1 request | 120 seconds | Per-phone resend cooldown |
| OTP attempts | 5 failed | 900 seconds | Per-phone lockout threshold |

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

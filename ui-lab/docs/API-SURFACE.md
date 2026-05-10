# BirGap UI Lab

## Overview
4 distinct UI/UX designs connected to the BirGap backend API. Each version is a standalone Vite+React app.

## Architecture

```
ui-lab/
├── shared/              # Shared API client + types (symlinked or copied per version)
├── v1-console/          # Terminal-style dark console
├── v2-glass/            # Glassmorphism frosted glass
├── v3-mobile/           # Mobile-first phone frame
├── v4-dashboard/        # Power-user multi-panel dashboard
└── docs/
    ├── LAB-PLAN.md      # This file
    ├── INTEGRATION.md   # Integration notes & errors
    └── API-SURFACE.md   # API reference extracted from backend
```

## API Surface (from backend)

### Auth
- `POST /auth/otp/request` — `{ phone: string }` → `{ phone: string, mode: string, expiresInSeconds: number }`
- `POST /auth/otp/verify` — `{ phone: string, code: string }` → `{ user: { id }, accessToken, refreshToken }`
- `POST /auth/refresh` — `{ refreshToken: string }` → `{ user: { id }, accessToken, refreshToken }`
- `POST /auth/logout` — Headers: Authorization: Bearer <jwt> — `{ refreshToken?: string }` → 204

### Messages
- `POST /messages` — `{ senderDeviceId, recipientUserId, idempotencyKey, envelopes: [{ recipientDeviceId, ciphertext }] }` → message
- `GET /messages/pending?deviceId=<id>` — → `{ deviceId, envelopes: [{ message, status, deliveredAt, readAt, ... }] }`
- `POST /messages/:messageId/ack` — `{ deviceId, status: 'DELIVERED'|'READ' }` → envelope

### Devices
- `POST /devices/register` — `{ deviceId?, platform, displayName, identityPublicKey, pushToken?, pushPlatform?, pushActive }` → device
- `GET /devices` — → device[]
- `DELETE /devices/:id` — → 204

### Prekeys
- `POST /devices/:deviceId/prekeys/refill` — `{ prekeys: [{ keyId, publicKey }] }` → `{ inserted }`
- `PUT /devices/:deviceId/signed-prekey` — `{ keyId, publicKey, signature }` → signedPrekey

### Users
- `GET /users/:userId/devices/key-bundles` — → `{ userId, devices: [{ deviceId, platform, identityPublicKey, signedPrekey, oneTimePrekey }] }`

### Realtime
- `POST /realtime/token` — `{ deviceId }` → `{ ticket, expiresAt }`
- WebSocket: `socket.io` with ticket auth
  - `typing.start` / `typing.stop` — `{ recipientUserId }`
  - `message.new` — emitted to device rooms
  - `presence.active` — emitted to user rooms
  - `message.ack` — emitted to sender user room

### Backups
- `PUT /backups/current` — `{ version, blob, checksum }` → backup
- `GET /backups/current` — → backup (with blob)
- `GET /backups/metadata` — → backup (without blob)

## Env
All versions use a shared `.env` pattern:
```
VITE_API_BASE_URL=http://localhost:3000
VITE_OTP_MODE=mock
```

## Plans
- v1-console: Terminal aesthetic, monospace fonts, dark background, green/cyan text
- v2-glass: Glassmorphism, blur effects, gradient backgrounds, modern
- v3-mobile: Phone frame wrapper, touch-optimized, bottom nav, swipe gestures
- v4-dashboard: Multi-panel, keyboard shortcuts, power-user features, split views
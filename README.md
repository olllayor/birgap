# BirGap Backend

Backend foundation for a chat-only, E2EE-ready 1:1 messenger.

## Stack

- NestJS
- Prisma
- Postgres
- Redis
- Socket.IO WebSockets

The backend stores public key material and opaque encrypted payloads only. Message content, media content, and backup content are encrypted client-side.

## Local Setup

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm prisma:migrate
pnpm start:dev
```

OpenAPI docs are available at `http://localhost:3000/docs`.

Mobile integration docs are available in [`docs/mobile-api-integration.md`](docs/mobile-api-integration.md).

## MVP Boundaries

In scope:

- Mock OTP auth
- Refresh-token rotation
- Up to 3 active devices per user
- Per-device signed prekeys and one-time prekeys
- 1:1 encrypted message envelope relay
- Idempotent message sending
- Server-assigned direct-thread sequence numbers
- WebSocket ticket auth
- Typing/presence events
- Opaque encrypted backup blob storage

Out of scope:

- Plaintext messaging
- Groups
- Channels
- Calls
- Media
- Bots
- Public discovery

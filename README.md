# BirGap Backend

Backend foundation for a chat-only, E2EE-ready 1:1 messenger.

## Stack

- NestJS
- Prisma
- Postgres
- Redis
- Socket.IO WebSockets

The backend stores public key material and opaque encrypted payloads only. Message content, media content, and backup content are encrypted client-side.

## Documentation

- [Architecture Overview](docs/architecture.md) - System design, data flows, and module structure
- [Developer Onboarding](docs/developer-onboarding.md) - Setup guide and development workflow
- [Security Model](docs/security-model.md) - E2EE architecture, threat model, and cryptographic design
- [API Reference](docs/api-reference.md) - Complete REST API documentation
- [Mobile Integration](docs/mobile-api-integration.md) - Mobile client integration guide
- [WebSocket Events](docs/websocket-events.md) - Realtime event contract
- [Deployment Guide](docs/deployment.md) - Production deployment and scaling
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions

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

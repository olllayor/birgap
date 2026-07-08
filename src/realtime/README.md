# Realtime — socket ticket contract

The WebSocket gateway does **not** accept the JWT access token directly. Clients
exchange a JWT for a short-lived, single-use **socket ticket** over REST, then
open the socket with that ticket. This keeps the long-lived JWT off the wire on
the socket transport and lets us revoke a session before a socket connects.

## Lifecycle

1. `POST /realtime/token` (JWT-guarded) with `{ deviceId }`.
   - Verifies the device is active for the user.
   - Returns `{ ticket, expiresAt }`. Only `sha256(ticket)` is stored server-side
     (`SocketTicket.tokenHash`).
2. Client connects to the gateway with the raw ticket in
   `handshake.auth.ticket` (preferred) or `handshake.query.ticket`.
3. On connect the gateway calls `consumeSocketTicket(ticket, socketId)`, which in
   a single transaction:
   - Rejects if the ticket is unknown, already consumed, or past `expiresAt`.
   - Rejects if the session's refresh token is revoked/expired.
   - Rejects if the device is no longer active.
   - Stamps `consumedAt` + `consumedBy = socketId` (**single-use**).
   - Updates `Device.lastSeenAt`.

## Guaranteed semantics (locked)

- **Single-use.** A ticket is valid for exactly one successful `consume`. The
  `consumedAt` check + write inside the connect transaction enforce it; a second
  connect with the same ticket fails with `Socket ticket is invalid`.
- **TTL.** Tickets expire `WEBSOCKET_TICKET_TTL_SECONDS` after issue
  (default **60s**). Past that they are rejected even if never consumed.
- **Fresh ticket per connection.** Because tickets are single-use and short-lived,
  every socket connect — including every reconnect — MUST first mint a new ticket
  via `POST /realtime/token`. Do not cache or reuse a ticket across reconnects.
- **No ticket → no socket.** A connect with a missing/invalid/expired/consumed
  ticket is disconnected immediately; identity (`userId`/`deviceId`/`sessionId`)
  is only established via a successful consume.

## Client rule of thumb

> On every (re)connect: `POST /realtime/token` → open socket with the returned
> `ticket` → discard it. Never reuse.

## Presence

- On connect the gateway emits `presence.active { userId, deviceId }` to the
  user's own room (multi-device awareness).
- On the **last** socket for a device closing, the gateway persists
  `Device.lastSeenAt` and emits `presence.inactive { userId, deviceId, lastSeenAt }`.
- `GET /users/:userId/presence` returns `{ userId, online, lastSeenAt }` for
  showing "last seen recently" under a chat title (`lastSeenAt` is `null` while
  the user is online).

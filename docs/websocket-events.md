# BirGap WebSocket Contract

Connect to the Socket.IO gateway with a single-use ticket from `POST /realtime/token`.

```ts
io(API_URL, {
  auth: { ticket: "single-use-ticket" }
})
```

## Server Events

- `message.new`: an encrypted envelope for this device.
- `message.ack`: delivered/read status changed.
- `typing.start`: another user started typing.
- `typing.stop`: another user stopped typing.
- `presence.active`: another user/device is active.

## Client Events

### Direct Typing

- `typing.start`: `{ "recipientUserId": "uuid" }`
- `typing.stop`: `{ "recipientUserId": "uuid" }`

### Group Typing

- `typing.start`: `{ "groupId": "uuid" }`
- `typing.stop`: `{ "groupId": "uuid" }`

Typing events are ephemeral, not stored, and expire client-side after 3 seconds. Group member lists are cached in Redis (5-minute TTL) to avoid repeated database queries on high-frequency typing events.

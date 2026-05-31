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
- `reaction.new`: a user added a reaction to a message.
- `reaction.removed`: a user removed their reaction from a message.

## Client Events

### Direct Typing

- `typing.start`: `{ "recipientUserId": "uuid" }`
- `typing.stop`: `{ "recipientUserId": "uuid" }`

### Group Typing

- `typing.start`: `{ "groupId": "uuid" }`
- `typing.stop`: `{ "groupId": "uuid" }`

Typing events are ephemeral, not stored, and expire client-side after 3 seconds. Group member lists are cached in Redis (5-minute TTL) to avoid repeated database queries on high-frequency typing events.

### Reaction Events

Reaction events are delivered to all participants in the conversation (direct thread or group) except the user who triggered the reaction.

**`reaction.new` payload**:
```json
{
  "reactionId": "uuid",
  "messageId": "uuid",
  "userId": "uuid",
  "emoji": "👍",
  "createdAt": "2026-05-16T10:00:00.000Z",
  "threadId": "uuid",
  "groupId": null
}
```

**`reaction.removed` payload**:
```json
{
  "reactionId": "uuid",
  "messageId": "uuid",
  "userId": "uuid",
  "emoji": "👍",
  "threadId": "uuid",
  "groupId": null
}
```

Reaction delivery uses Socket.IO user rooms for direct threads (inline emit) and BullMQ queue for groups (async fanout to all group members).

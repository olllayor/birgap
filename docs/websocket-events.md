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
- `message.deleted`: a message was tombstoned (delete for everyone).
- `message.edited`: a message was edited (new ciphertext available).
- `typing.start`: another user started typing.
- `typing.stop`: another user stopped typing.
- `presence.active`: another user/device is active.
- `reaction.new`: a user added a reaction to a message.
- `reaction.removed`: a user removed their reaction from a message.
- `message.tombstoned.platform`: a message was tombstoned by a moderator / admin (not a self-delete or group-admin delete). Delivered to thread participants or group members.
- `user.kicked`: a user is being forcibly disconnected (e.g. on suspension). The client should not reconnect with the same session.

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

### Delete Events

**`message.deleted` payload**:
```json
{
  "messageId": "uuid",
  "threadId": "uuid",
  "groupId": null,
  "senderUserId": "uuid",
  "deletedAt": "2026-05-16T10:00:00.000Z",
  "deletedBy": "SENDER"
}
```

Delete events are delivered to all conversation participants except the sender. For direct threads, delivery is inline via Socket.IO user rooms. For groups, delivery is async via the same fanout pattern used for reactions.

### Edit Events

**`message.edited` payload**:
```json
{
  "messageId": "uuid",
  "threadId": "uuid",
  "groupId": null,
  "senderUserId": "uuid",
  "senderDeviceId": "uuid",
  "editedAt": "2026-05-16T10:00:00.000Z"
}
```

Edit events are delivered to all conversation participants except the sender. For direct threads, delivery is inline via Socket.IO user rooms. For groups, delivery is async via the same fanout pattern used for reactions. Offline clients receive a silent push wakeup to trigger sync.

### Moderator Tombstone Events

**`message.tombstoned.platform` payload** (emitted by the moderation module after a moderator or admin tombstones a message via `POST /admin/messages/:id/tombstone`):

```json
{
  "messageId": "uuid",
  "threadId": "uuid | null",
  "groupId": "uuid | null",
  "senderUserId": "uuid",
  "scope": "platform",
  "tombstonedBy": "uuid",
  "at": "2026-06-06T12:00:00.000Z"
}
```

Delivered to:
- For a direct thread: the thread participants (excluding the actor)
- For a group: every group member (excluding the actor)

Self-deletes and group-admin deletes do **not** emit this event — they go through the existing `message.deleted` / `message.deleted.group` channels above. This event is specifically for moderator-level tombstones that should be visible across the whole thread or group.

### Forced Disconnect

**`user.kicked` payload**:

```json
{
  "reason": "SUSPENDED",
  "at": "2026-06-06T12:00:00.000Z"
}
```

The realtime gateway subscribes to a Redis channel (`realtime:user-kicked`) so that a suspension on one gateway node disconnects the user's sockets on every node. On receipt, the client should:
1. Stop any in-flight operations that require the current session.
2. Show a "your account is suspended" UI (see `Account Suspension Response Shape` in `api-reference.md`).
3. Do not attempt to reconnect with the same session; the suspended status is enforced by the JWT guard on every subsequent REST call.

# Message Replies Feature Plan

## Overview

Add single-level message replies (WhatsApp/Telegram style) to BirGap. A message can optionally reference another message in the same thread/group via a `replyToMessageId` field. The server validates the reference exists in the same conversation before persisting.

**Design decisions:**
- Single-level replies only (no nested threading) — enforced server-side by rejecting replies to messages that are themselves replies
- Server-side validation of the reply reference (existence + same-conversation + depth check)
- `replyToMessageId` stored as unencrypted metadata on the `Message` model (the server needs it for validation, GraphQL resolution, and real-time events)
- Reply preview content (quoted text, sender name) lives inside the encrypted `ciphertext` payload — the server never sees it
- Dedicated `@Resolver(() => MessageType)` for the `replyTo` field — shared across direct and group contexts
- Batched `replyTo` resolution via a request-scoped `MessageLoader` (same pattern as existing `UserLoader`) to prevent N+1 queries

---

## 1. Database Schema Migration

**File:** `prisma/schema.prisma`

Add a self-referential nullable FK on the `Message` model:

```prisma
model Message {
  // ... existing fields ...
  replyToMessageId String? @db.Uuid

  replyTo    Message?  @relation("MessageReplies", fields: [replyToMessageId], references: [id], onDelete: SetNull)
  replies    Message[] @relation("MessageReplies")

  // ... existing constraints ...
  @@index([replyToMessageId])
}
```

**Migration SQL:**
```sql
ALTER TABLE "Message" ADD COLUMN "replyToMessageId" UUID;
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToMessageId_fkey"
  FOREIGN KEY ("replyToMessageId") REFERENCES "Message"("id") ON DELETE SET NULL;
CREATE INDEX "Message_replyToMessageId_idx" ON "Message"("replyToMessageId");
```

**Rationale for `onDelete: SetNull`:** If the parent message is ever deleted (future feature), the reply keeps its content but loses the reference — no cascade deletion.

---

## 2. DTO Changes

### 2.1 Direct Message DTO

**File:** `src/messages/dto/send-message.dto.ts`

Add optional `replyToMessageId`:

```typescript
export class SendMessageDto {
  // ... existing fields ...

  @ApiProperty({ required: false, description: 'ID of the message being replied to (must be in the same thread).' })
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}
```

### 2.2 Group Message DTO

**File:** `src/groups/dto/send-group-message.dto.ts`

Add optional `replyToMessageId`:

```typescript
export class SendGroupMessageDto {
  // ... existing fields ...

  @ApiProperty({ required: false, description: 'ID of the message being replied to (must be in the same group).' })
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
}
```

---

## 3. Service Layer Changes

### 3.1 Direct Message Send (`MessagesService.send`)

**File:** `src/messages/messages.service.ts`

Inside the `$transaction` block, after thread resolution and before `message.create`:

1. If `dto.replyToMessageId` is provided:
   - Query `Message` by `id = dto.replyToMessageId`
   - If not found → throw `NotFoundException('Reply target message not found')`
   - If `message.threadId !== thread.id` → throw `BadRequestException('Reply target is not in the same thread')`

2. Pass `replyToMessageId` to `message.create` data.

3. Update `serializeMessage()` to include `replyToMessageId`.

4. Update `getPending()` message select to include `replyToMessageId`.

**Pseudocode for validation (inside transaction):**
```typescript
let replyToMessageId: string | null = null;
if (dto.replyToMessageId) {
  const replyTarget = await tx.message.findUnique({
    where: { id: dto.replyToMessageId },
    select: { id: true, threadId: true, replyToMessageId: true },
  });
  if (!replyTarget) {
    throw new NotFoundException('Reply target message not found');
  }
  if (replyTarget.threadId !== thread.id) {
    throw new BadRequestException('Reply target is not in the same thread');
  }
  if (replyTarget.replyToMessageId) {
    throw new BadRequestException('Cannot reply to a message that is itself a reply');
  }
  replyToMessageId = replyTarget.id;
}
```

### 3.2 Group Message Send (`GroupsService.queueGroupMessage`)

**File:** `src/groups/groups.service.ts`

Inside the `$transaction` block, before `message.create`:

1. If `dto.replyToMessageId` is provided:
   - Query `Message` by `id = dto.replyToMessageId`
   - If not found → throw `NotFoundException`
   - If `message.groupId !== groupId` → throw `BadRequestException`

2. Pass `replyToMessageId` to `message.create` data.

3. Pass `replyToMessageId` through to the BullMQ fanout job data.

**Pseudocode:**
```typescript
let replyToMessageId: string | null = null;
if (dto.replyToMessageId) {
  const replyTarget = await tx.message.findUnique({
    where: { id: dto.replyToMessageId },
    select: { id: true, groupId: true, replyToMessageId: true },
  });
  if (!replyTarget) {
    throw new NotFoundException('Reply target message not found');
  }
  if (replyTarget.groupId !== groupId) {
    throw new BadRequestException('Reply target is not in the same group');
  }
  if (replyTarget.replyToMessageId) {
    throw new BadRequestException('Cannot reply to a message that is itself a reply');
  }
  replyToMessageId = replyTarget.id;
}
```

**Cross-conversation protection:** The `groupId !== groupId` check implicitly rejects direct-thread message IDs submitted to a group send — a direct message has `groupId: null`, which will never equal the target `groupId`. Same applies in reverse for the direct-thread check.

---

## 4. Group Fanout Processor

**File:** `src/groups/queue/group-fanout.processor.ts`

### 4.1 Job Data Interface

Add `replyToMessageId` to `GroupFanoutJobData`:

```typescript
export interface GroupFanoutJobData {
  // ... existing fields ...
  replyToMessageId: string | null;
}
```

### 4.2 Event Payload

Include `replyToMessageId` in the `message.created` event payload so it propagates through WebSocket:

```typescript
const messageEventPayload = {
  // ... existing fields ...
  replyToMessageId,  // <-- add this
  envelopes: targetDevices.map((device) => ({
    // ... existing fields ...
    message: {
      // ... existing fields ...
      replyToMessageId,  // <-- add this
    },
  })),
};
```

---

## 5. GraphQL Model + Resolver + DataLoader

### 5.1 GraphQL Type

**File:** `src/messages/models/message.model.ts`

Add `replyToMessageId` field and a `replyTo` relation field:

```typescript
@ObjectType('Message')
export class MessageType {
  // ... existing fields ...

  @Field(() => ID, { nullable: true })
  replyToMessageId!: string | null;

  @Field(() => MessageType, { nullable: true })
  replyTo?: MessageType | null;
}
```

### 5.2 MessageLoader (N+1 prevention)

**File:** `src/common/loaders/message.loader.ts` (new)

Follow the exact same pattern as the existing `UserLoader` (`src/common/loaders/user.loader.ts`):

- `@Injectable({ scope: Scope.REQUEST })` — fresh instance per GraphQL request
- `load(id)` → queues ID, schedules batch dispatch via `setTimeout(0)`
- Batch dispatch: single `prisma.message.findMany({ where: { id: { in: ids } } })`, map results back to individual promises
- Cache resolved values to avoid duplicate fetches within the same request

```typescript
@Injectable({ scope: Scope.REQUEST })
export class MessageLoader {
  private cache = new Map<string, Promise<Message | null>>();
  private batchKeySet = new Set<string>();
  private resolvers = new Map<string, Resolver[]>();
  private dispatchTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  load(id: string): Promise<Message | null> {
    // ... same batching pattern as UserLoader ...
    // Batch query: prisma.message.findMany({ where: { id: { in: ids } } })
  }
}
```

This eliminates the N+1 problem: a conversation returning 50 messages with 30 replies triggers **1 batched query** instead of 30 sequential `findUnique` calls.

### 5.3 Dedicated MessagesResolver

**File:** `src/messages/messages.resolver.ts` (new)

Create a dedicated `@Resolver(() => MessageType)` — **not** duplicated in `DirectThreadsResolver` and `GroupsResolver`. One resolver for the `Message` type, shared across both direct and group contexts.

```typescript
@UseGuards(GqlAuthGuard)
@Resolver(() => MessageType)
export class MessagesResolver {
  constructor(private readonly messageLoader: MessageLoader) {}

  @ResolveField('replyTo', () => MessageType, { nullable: true })
  async replyTo(@Parent() message: MessageType) {
    if (!message.replyToMessageId) return null;
    return this.messageLoader.load(message.replyToMessageId);
  }
}
```

### 5.4 Module Registration

**File:** `src/messages/messages.module.ts`

Register `MessagesResolver` and `MessageLoader` as providers:

```typescript
@Module({
  imports: [AuthModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesResolver, MessageLoader],
  exports: [MessagesService],
})
export class MessagesModule {}
```

Also register `MessageLoader` in `DirectThreadsModule` and `GroupsModule` (same pattern as `UserLoader` registration) so it's available when those resolvers return `MessageType` objects.

---

## 6. Real-Time Events

### 6.1 WebSocket Payload

**File:** `src/realtime/realtime.gateway.ts`

The `message.new` event currently sends the envelope object. The `replyToMessageId` will naturally flow through since it's part of the serialized message/envelope data from `MessagesService.send()` and `GroupFanoutProcessor`.

No changes needed to the gateway handler itself — the `onMessageCreated` handler already forwards the full envelope payload. But we need to ensure `replyToMessageId` is included in the envelope's nested `message` object.

### 6.2 Direct Message Flow

In `MessagesService.send()`, the `serializeMessage()` method must include `replyToMessageId` so the `message.created` event carries it. The envelope objects returned from Prisma's `include: { envelopes: true }` don't include the parent message's `replyToMessageId` in the nested structure, so we add it to the serialization.

### 6.3 Group Message Flow

In `GroupFanoutProcessor`, the constructed `messageEventPayload` must include `replyToMessageId` at both the top level and inside each envelope's `message` sub-object.

---

## 7. Pending Messages Query

**File:** `src/messages/messages.service.ts` (`getPending` method)

Update the `message.select` inside `getPending()` to include `replyToMessageId`:

```typescript
include: {
  message: {
    select: {
      id: true,
      threadId: true,
      groupId: true,
      senderUserId: true,
      senderDeviceId: true,
      threadSequence: true,
      replyToMessageId: true,  // <-- add this
      createdAt: true,
    },
  },
},
```

---

## 8. GraphQL Message Queries

**Files:** `src/direct-threads/direct-threads.resolver.ts`, `src/groups/groups.resolver.ts`

The existing `messages` field resolvers use `prisma.message.findMany()` which returns all fields by default. Since `replyToMessageId` will be a new column, it will be automatically included in query results. No changes needed to the query logic.

However, the `replyTo` field resolver (Section 5.1) will handle lazy-loading the parent message when requested via GraphQL.

---

## 9. Serialization Updates

**File:** `src/messages/messages.service.ts`

Update `serializeMessage()` signature and body:

```typescript
private serializeMessage(message: {
  id: string;
  threadId: string | null;
  groupId?: string | null;
  senderUserId: string;
  senderDeviceId: string;
  threadSequence: number;
  replyToMessageId?: string | null;  // <-- add this
  createdAt: Date;
  envelopes: unknown[];
}) {
  return {
    id: message.id,
    threadId: message.threadId,
    groupId: message.groupId ?? null,
    senderUserId: message.senderUserId,
    senderDeviceId: message.senderDeviceId,
    threadSequence: message.threadSequence,
    replyToMessageId: message.replyToMessageId ?? null,  // <-- add this
    createdAt: message.createdAt,
    envelopes: message.envelopes,
  };
}
```

---

## 10. Files Changed Summary

| # | File | Change |
|---|------|--------|
| 1 | `prisma/schema.prisma` | Add `replyToMessageId` field + self-relation + index on `Message` |
| 2 | `prisma/migrations/<timestamp>_add_reply_to_message/migration.sql` | New migration |
| 3 | `src/messages/dto/send-message.dto.ts` | Add optional `replyToMessageId` field |
| 4 | `src/groups/dto/send-group-message.dto.ts` | Add optional `replyToMessageId` field |
| 5 | `src/messages/messages.service.ts` | Validate reply target (existence + same-thread + depth) in `send()`, update `serializeMessage()`, update `getPending()` select |
| 6 | `src/groups/groups.service.ts` | Validate reply target (existence + same-group + depth) in `queueGroupMessage()`, pass to fanout job |
| 7 | `src/groups/queue/group-fanout.processor.ts` | Add `replyToMessageId` to job data interface + event payload |
| 8 | `src/messages/models/message.model.ts` | Add `replyToMessageId` + `replyTo` fields to GraphQL type |
| 9 | `src/common/loaders/message.loader.ts` | **NEW** — request-scoped batched loader (same pattern as `UserLoader`) |
| 10 | `src/messages/messages.resolver.ts` | **NEW** — dedicated `@Resolver(() => MessageType)` with `replyTo` field resolver using `MessageLoader` |
| 11 | `src/messages/messages.module.ts` | Register `MessagesResolver` + `MessageLoader` as providers |
| 12 | `src/direct-threads/direct-threads.module.ts` | Register `MessageLoader` as provider |
| 13 | `src/groups/groups.module.ts` | Register `MessageLoader` as provider |
| 14 | `src/schema.gql` | Auto-regenerated by NestJS GraphQL on build |

---

## 11. Implementation Order

1. **Prisma schema + migration** — foundation for everything
2. **DTOs** — add `replyToMessageId` to both send DTOs
3. **MessagesService.send()** — validation (existence + same-thread + depth) + persistence for direct messages
4. **GroupsService.queueGroupMessage()** — validation (existence + same-group + depth) + persistence for group messages
5. **GroupFanoutProcessor** — propagate `replyToMessageId` through job data + event payload
6. **Serialization** — update `serializeMessage()` and `getPending()` select
7. **MessageLoader** — new request-scoped batched loader following `UserLoader` pattern
8. **MessagesResolver** — dedicated `@Resolver(() => MessageType)` with `replyTo` field using `MessageLoader`
9. **Module registration** — wire `MessagesResolver` + `MessageLoader` into `MessagesModule`, `DirectThreadsModule`, `GroupsModule`
10. **Tests** — unit tests for validation logic (including depth + cross-conversation), integration tests for send flows + GraphQL batching

---

## 12. Testing Plan

### Unit Tests
- `MessagesService.send()` with valid `replyToMessageId` in same thread → succeeds
- `MessagesService.send()` with `replyToMessageId` pointing to message in different thread → `BadRequestException`
- `MessagesService.send()` with non-existent `replyToMessageId` → `NotFoundException`
- `MessagesService.send()` with `replyToMessageId` that is itself a reply → `BadRequestException` (depth enforcement)
- `MessagesService.send()` without `replyToMessageId` → works as before (backward compatible)
- `GroupsService.queueGroupMessage()` with valid `replyToMessageId` in same group → succeeds
- `GroupsService.queueGroupMessage()` with `replyToMessageId` in different group → `BadRequestException`
- `GroupsService.queueGroupMessage()` with `replyToMessageId` that is itself a reply → `BadRequestException` (depth enforcement)
- **Cross-conversation leak:** `GroupsService.queueGroupMessage()` with a direct-thread message ID as `replyToMessageId` → `BadRequestException` (target has `groupId: null`, fails `groupId !== groupId` check)
- **Cross-conversation leak:** `MessagesService.send()` with a group message ID as `replyToMessageId` → `BadRequestException` (target has `threadId: null`, fails `threadId !== thread.id` check)

### Integration Tests
- Full send flow: POST `/messages` with `replyToMessageId` → verify DB record has `replyToMessageId` set + event payload includes it
- Full group send flow: POST `/groups/:id/envelopes` with `replyToMessageId` → verify DB + fanout job data includes `replyToMessageId`
- GET `/messages/pending` → verify `replyToMessageId` is included in response
- GraphQL query with `replyTo` field → verify parent message is resolved via `MessageLoader` (batched, not N+1)
- GraphQL query with multiple messages having `replyTo` → verify single batched DB query (not N sequential queries)

---

## 13. API Contract Changes

### POST /messages (Direct)

**Request body** (new optional field):
```json
{
  "senderDeviceId": "uuid",
  "recipientUserId": "uuid",
  "idempotencyKey": "string",
  "replyToMessageId": "uuid",  // NEW, optional
  "envelopes": [...]
}
```

**Response** (new field):
```json
{
  "id": "uuid",
  "threadId": "uuid",
  "replyToMessageId": "uuid",  // NEW, null if not a reply
  ...
}
```

### POST /groups/:id/envelopes (Group)

**Request body** (new optional field):
```json
{
  "senderDeviceId": "uuid",
  "idempotencyKey": "string",
  "replyToMessageId": "uuid",  // NEW, optional
  "ciphertext": {...}
}
```

### WebSocket `message.new` Event

**Payload** (new field on nested message):
```json
{
  "messageId": "uuid",
  "recipientDeviceId": "uuid",
  "message": {
    "id": "uuid",
    "replyToMessageId": "uuid",  // NEW
    ...
  }
}
```

### GraphQL

```graphql
type Message {
  id: ID!
  threadId: ID
  groupId: ID
  senderUserId: ID!
  senderDeviceId: ID!
  threadSequence: Int!
  replyToMessageId: ID       # NEW
  replyTo: Message           # NEW, resolves parent message
  createdAt: DateTime!
}
```

---

## 14. Backward Compatibility

- `replyToMessageId` is optional everywhere — existing clients that don't send it will get `null` in responses
- No breaking changes to existing API contracts
- The migration is additive (new nullable column)
- Existing WebSocket event consumers can ignore the new field

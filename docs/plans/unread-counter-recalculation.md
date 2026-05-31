# Unread Counter Recalculation Plan

## Problem Statement

The backend currently has no server-side unread counter. The `MessageEnvelope` model tracks per-device delivery/read status (PENDING/DELIVERED/READ), but there is no aggregation, counting, or API endpoint for unread totals. The mobile app spec expects `unreadCount` but tracks it client-side only, leading to potential drift and sync issues across devices.

## Design Decisions

### 1. Schema: Non-Nullable Composite PK with `threadType` Discriminator

**Problem**: Initial plan used `@@id([userId, threadId])` which creates collisions when DirectThread.id and Group.id happen to be the same UUID.

**Solution**: Add `threadType` to the composite primary key.

```prisma
model UnreadCounter {
  userId     String   @db.Uuid
  threadType String   // 'direct' | 'group'
  threadId   String   @db.Uuid
  count      Int      @default(0)
  updatedAt  DateTime @updatedAt

  @@id([userId, threadType, threadId])
  @@index([userId])
}
```

**Rationale**: 
- No nullable fields in PK → `upsert` works cleanly across all Postgres versions
- `threadType` disambiguates direct vs group threads
- API response maps `threadType` to appropriate field if client needs `{ threadId }` vs `{ groupId }`

### 2. COUNT Query: DISTINCT messageId + Exclude Sender

**Problem**: Counting envelopes directly over-counts:
- Multiple devices per user → N envelopes per message
- Sender gets sync envelopes → counts their own messages

**Solution**: Use `COUNT(DISTINCT messageId)` and exclude sender's own messages.

```sql
SELECT COUNT(DISTINCT e."messageId") as count
FROM "MessageEnvelope" e
JOIN "Message" m ON e."messageId" = m.id
WHERE e."recipientUserId" = $userId
  AND m."senderUserId" != $userId
  AND (
    ($threadType = 'direct' AND m."threadId" = $threadId)
    OR
    ($threadType = 'group' AND m."groupId" = $threadId)
  )
  AND e.status != 'READ'
```

**Rationale**:
- `DISTINCT messageId` → one count per message regardless of device count
- `senderUserId != userId` → excludes sync envelopes
- `threadType`-aware join → no collision between direct/group

**Index Required**: Add `@@index([recipientUserId, status])` to `MessageEnvelope` to avoid sequential scans.

### 3. ACK Fix: Bulk Update All Devices

**Problem**: Current `ack()` updates single envelope by `{messageId, recipientDeviceId}`. If user has 3 devices and only marks READ on one, the other 2 remain unread → count never drops.

**Solution**: When `status === 'READ'`, bulk-update ALL envelopes for that user+message.

```ts
if (dto.status === 'READ') {
  await this.prisma.messageEnvelope.updateMany({
    where: {
      messageId,
      recipientUserId: userId,
      status: { not: 'READ' },
    },
    data: { status: 'READ', readAt: now, deliveredAt: envelope.deliveredAt ?? now },
  });
}
```

**Rationale**: 
- Single-device `findUnique` stays for validation (proves user owns envelope)
- `updateMany` marks all devices as READ atomically
- Recalc job then sees correct state

### 4. Debounce Key: Include `threadType`

**Problem**: Initial debounce key `${userId}:${threadId}` collides when direct and group have same UUID.

**Solution**: Include `threadType` in the key.

```ts
await this.unreadQueue.add('recalc', jobData, {
  jobId: `${userId}:${threadType}:${threadId}`,
  delay: 500,
  removeOnComplete: true,
});
```

**Rationale**:
- 500ms delay keeps job in `waiting` state long enough to absorb rapid-fire events
- `threadType` in key prevents cross-thread collisions
- BullMQ deduplicates by jobId when job is in `waiting` state

### 5. mark-all-read: Enqueue Only, Let Processor Handle

**Problem**: Initial plan did both upsert + enqueue → double-write, potential race.

**Solution**: Enqueue recalc with `reason: 'mark_all_read'`, processor handles everything.

**Processor fast path**:
1. Bulk `updateMany` all non-READ envelopes for user+thread to READ
2. Upsert `UnreadCounter` with `count: 0`
3. Emit `unread.updated` event
4. Skip COUNT query entirely

**Rationale**:
- Single source of truth (processor)
- No race between upsert and recalc
- Fast path avoids expensive COUNT when we know the answer

### 6. mark-all-read: No Per-Message ACK Events

**Problem**: Emitting `message.ack` for every message in mark-all-read could be hundreds of events.

**Solution**: Emit single `messages.marked_all_read` event with `{ userId, threadId, threadType }`.

**Rationale**:
- Client can update local state from single event
- Avoids flooding WebSocket with hundreds of ack events
- Simpler for client to handle

## Schema Changes

### New Model: `UnreadCounter`

```prisma
model UnreadCounter {
  userId     String   @db.Uuid
  threadType String   // 'direct' | 'group'
  threadId   String   @db.Uuid
  count      Int      @default(0)
  updatedAt  DateTime @updatedAt

  @@id([userId, threadType, threadId])
  @@index([userId])
}
```

### New Index on `MessageEnvelope`

```prisma
@@index([recipientUserId, status])
```

**Migration**: `add_unread_counter_and_index`

## BullMQ Queue: `unread-recalc`

### Job Interface

```ts
// src/unread/queue/unread-recalc-job.interface.ts
export interface UnreadRecalcJobData {
  userId: string;
  threadId: string;
  threadType: 'direct' | 'group';
  reason: 'new_message' | 'ack_read' | 'mark_all_read' | 'recalc';
}
```

### Processor

```ts
// src/unread/queue/unread-recalc.processor.ts
@Processor('unread-recalc', { concurrency: 5 })
export class UnreadRecalcProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<UnreadRecalcJobData>): Promise<void> {
    const { userId, threadId, threadType, reason } = job.data;

    if (reason === 'mark_all_read') {
      // Fast path: bulk update + set count to 0
      await this.prisma.$transaction(async (tx) => {
        await tx.messageEnvelope.updateMany({
          where: {
            recipientUserId: userId,
            message: threadType === 'direct'
              ? { threadId }
              : { groupId: threadId },
            status: { not: 'READ' },
          },
          data: { status: 'READ', readAt: new Date() },
        });

        await tx.unreadCounter.upsert({
          where: { userId_threadType_threadId: { userId, threadType, threadId } },
          update: { count: 0 },
          create: { userId, threadType, threadId, count: 0 },
        });
      });
    } else {
      // COUNT query path
      const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT e."messageId") as count
        FROM "MessageEnvelope" e
        JOIN "Message" m ON e."messageId" = m.id
        WHERE e."recipientUserId" = ${userId}::uuid
          AND m."senderUserId" != ${userId}::uuid
          AND ${threadType === 'direct'
            ? Prisma.sql`m."threadId" = ${threadId}::uuid`
            : Prisma.sql`m."groupId" = ${threadId}::uuid`}
          AND e.status != 'READ'
      `;

      const count = Number(result[0].count);

      await this.prisma.unreadCounter.upsert({
        where: { userId_threadType_threadId: { userId, threadType, threadId } },
        update: { count },
        create: { userId, threadType, threadId, count },
      });
    }

    // Emit event for realtime broadcast
    this.events.emit('unread.updated', { userId, threadId, threadType, count });
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<UnreadRecalcJobData>) {
    this.queueMetrics.recordCompleted('unread-recalc');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<UnreadRecalcJobData>, error: Error) {
    this.queueMetrics.recordFailed('unread-recalc');
    this.logger.error(`Unread recalc job ${job.id} failed: ${error.message}`);
  }
}
```

### Queue Registration

```ts
// src/unread/unread.module.ts
BullModule.registerQueue({
  name: 'unread-recalc',
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { count: 100, age: 7 * 24 * 3600 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
})
```

## Trigger Points

### A. Direct Message Send

**Location**: `MessagesService.send()` after line 117

```ts
this.events.emit('message.created', this.serializeMessage(created));

// Enqueue unread recalc for recipient
await this.unreadService.enqueueRecalc({
  userId: dto.recipientUserId,
  threadId: created.threadId,
  threadType: 'direct',
  reason: 'new_message',
});
```

**Note**: Do NOT enqueue for sender — their sync envelopes are excluded by COUNT query.

### B. Group Message Fanout

**Location**: `GroupFanoutProcessor.process()` after line 62

```ts
await this.prisma.messageEnvelope.createMany({ data: envelopes, skipDuplicates: true });

// Extract unique recipient user IDs, exclude sender
const recipientUserIds = [...new Set(targetDevices.map(d => d.userId))]
  .filter(uid => uid !== senderUserId);

// Enqueue recalc for each recipient
await Promise.all(
  recipientUserIds.map(uid =>
    this.unreadService.enqueueRecalc({
      userId: uid,
      threadId: groupId,
      threadType: 'group',
      reason: 'new_message',
    })
  )
);
```

### C. Single Message ACK

**Location**: `MessagesService.ack()` after bulk updateMany

```ts
if (dto.status === 'READ') {
  // Bulk update all devices
  await this.prisma.messageEnvelope.updateMany({
    where: {
      messageId,
      recipientUserId: userId,
      status: { not: 'READ' },
    },
    data: { status: 'READ', readAt: now, deliveredAt: envelope.deliveredAt ?? now },
  });

  // Enqueue recalc
  const threadId = updated.message.threadId ?? updated.message.groupId;
  const threadType = updated.message.threadId ? 'direct' : 'group';
  
  await this.unreadService.enqueueRecalc({
    userId,
    threadId,
    threadType,
    reason: 'ack_read',
  });
}
```

### D. Mark All Read

**Location**: New endpoint `POST /messages/mark-all-read`

```ts
// MessagesController
@Post('mark-all-read')
markAllRead(
  @CurrentUser() user: AuthenticatedUser,
  @Body() dto: MarkAllReadDto,
) {
  return this.messagesService.markAllRead(user.userId, dto);
}

// MessagesService
async markAllRead(userId: string, dto: MarkAllReadDto) {
  await this.assertActiveDevice(userId, dto.deviceId);

  await this.unreadService.enqueueRecalc({
    userId,
    threadId: dto.threadId,
    threadType: dto.threadType,
    reason: 'mark_all_read',
  });

  // Emit event for realtime (no per-message ack events)
  this.events.emit('messages.marked_all_read', {
    userId,
    threadId: dto.threadId,
    threadType: dto.threadType,
  });

  return { success: true };
}
```

## API Endpoints

### GET /messages/unread-counts

Returns all unread counts for authenticated user.

**Response**:
```json
[
  { "threadType": "direct", "threadId": "uuid", "count": 3 },
  { "threadType": "group", "threadId": "uuid", "count": 12 }
]
```

**Implementation**:
```ts
@Get('unread-counts')
getUnreadCounts(@CurrentUser() user: AuthenticatedUser) {
  return this.messagesService.getUnreadCounts(user.userId);
}

// MessagesService
async getUnreadCounts(userId: string) {
  return this.prisma.unreadCounter.findMany({
    where: { userId },
    select: { threadType: true, threadId: true, count: true },
  });
}
```

### POST /messages/mark-all-read

Marks all messages in a thread as read.

**Request**:
```json
{
  "threadId": "uuid",
  "threadType": "direct",
  "deviceId": "uuid"
}
```

**Response**:
```json
{ "success": true }
```

## Realtime Events

### unread.updated

Emitted by `UnreadRecalcProcessor` after recalculation.

**Handler in RealtimeGateway**:
```ts
@OnEvent('unread.updated')
onUnreadUpdated(payload: { userId: string; threadId: string; threadType: string; count: number }) {
  this.server.to(`user:${payload.userId}`).emit('unread.updated', {
    threadId: payload.threadId,
    threadType: payload.threadType,
    count: payload.count,
  });
}
```

### messages.marked_all_read

Emitted by `MessagesService.markAllRead()`.

**Handler in RealtimeGateway**:
```ts
@OnEvent('messages.marked_all_read')
onMarkedAllRead(payload: { userId: string; threadId: string; threadType: string }) {
  this.server.to(`user:${payload.userId}`).emit('messages.marked_all_read', {
    threadId: payload.threadId,
    threadType: payload.threadType,
  });
}
```

## File Changes

### Create

| File | Purpose |
|---|---|
| `src/unread/unread.module.ts` | Module with queue registration |
| `src/unread/unread.service.ts` | `enqueueRecalc()`, `getCounts()` |
| `src/unread/unread.controller.ts` | REST endpoints (if needed) |
| `src/unread/queue/unread-recalc.processor.ts` | BullMQ worker |
| `src/unread/queue/unread-recalc-job.interface.ts` | Typed job data |
| `src/messages/dto/mark-all-read.dto.ts` | DTO for mark-all-read |

### Modify

| File | Changes |
|---|---|
| `prisma/schema.prisma` | Add `UnreadCounter` model + `@@index([recipientUserId, status])` on `MessageEnvelope` |
| `src/app.module.ts` | Import `UnreadModule` |
| `src/messages/messages.service.ts` | Fix `ack()` bulk READ, inject `UnreadService`, trigger recalc on send/ack, add `markAllRead()` and `getUnreadCounts()` |
| `src/messages/messages.controller.ts` | Add `markAllRead` and `getUnreadCounts` routes |
| `src/groups/queue/group-fanout.processor.ts` | Inject `UnreadService`, enqueue recalc after `createMany` |
| `src/realtime/realtime.gateway.ts` | Handle `unread.updated` + `messages.marked_all_read` events |
| `src/queues/queues.module.ts` | Register `unread-recalc` in Bull Board |

## Execution Order

1. **Prisma migration**
   - Add `UnreadCounter` model
   - Add `@@index([recipientUserId, status])` to `MessageEnvelope`
   - Run `prisma migrate dev --name add_unread_counter_and_index`

2. **Create unread module**
   - `unread-recalc-job.interface.ts`
   - `unread-recalc.processor.ts`
   - `unread.service.ts`
   - `unread.module.ts`

3. **Fix MessagesService.ack()**
   - Bulk READ update across all devices
   - Enqueue recalc with `reason: 'ack_read'`

4. **Wire recalc triggers**
   - `MessagesService.send()` → enqueue for recipient
   - `GroupFanoutProcessor.process()` → enqueue for each member (excluding sender)

5. **Add mark-all-read endpoint**
   - `mark-all-read.dto.ts`
   - `MessagesController.markAllRead()`
   - `MessagesService.markAllRead()` → enqueue only

6. **Add get-unread-counts endpoint**
   - `MessagesController.getUnreadCounts()`
   - `MessagesService.getUnreadCounts()`

7. **Add realtime event handlers**
   - `RealtimeGateway.onUnreadUpdated()`
   - `RealtimeGateway.onMarkedAllRead()`

8. **Register in AppModule and QueuesModule**
   - Import `UnreadModule` in `AppModule`
   - Register `unread-recalc` in `QueuesModule` Bull Board

9. **Build + lint verification**
   - `pnpm build`
   - `pnpm lint`
   - `pnpm typecheck` (if available)

## Testing Strategy

### Unit Tests
- `UnreadRecalcProcessor.process()` with mocked Prisma
  - Test COUNT query path
  - Test mark_all_read fast path
  - Test event emission

### Integration Tests
- Direct message flow: send → verify recipient count increments
- Group message flow: send → verify all members' counts increment (except sender)
- ACK flow: mark READ → verify count decrements
- Mark-all-read: verify count resets to 0
- Multi-device: mark READ on one device → verify all devices marked READ

### Manual Testing
- Use Bull Board at `/queues` to monitor `unread-recalc` jobs
- Verify debounce behavior (rapid messages → single recalc)
- Verify realtime events via WebSocket client

## Performance Considerations

- **COUNT query**: Indexed on `recipientUserId + status`, should be fast (<10ms for typical thread)
- **Debounce**: 500ms delay absorbs burst, reduces queue load
- **Concurrency**: 5 workers handle parallel recalcs
- **mark_all_read fast path**: Skips COUNT query, bulk update is O(n) where n = unread messages
- **Queue metrics**: Prometheus counters for monitoring

## Future Enhancements

- **Batch recalc**: For users with many threads, batch multiple recalcs into single query
- **Redis cache**: Cache unread counts in Redis for faster reads, invalidate on recalc
- **Scheduled recalc**: Nightly job to recalc all counters (catch any drift)
- **Client-side optimistic updates**: Client increments locally on message receive, syncs on reconnect

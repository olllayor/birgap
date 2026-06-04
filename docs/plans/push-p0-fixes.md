# Push Notification P0 Fixes

## Scope

Three correctness fixes for the FCM push notification pipeline:

1. **iOS push path is FCM-bridged-to-APNS**, not a native APNS provider. The mobile client must register iOS devices with `pushPlatform: 'FCM'`.
2. **iOS new-message wakeup** now includes `apns-push-type: background` and `apns-priority: 5` headers (matching the edit/delete path).
3. **Push is suppressed for devices that are currently online** via WebSocket, to avoid wasted FCM quota and pointless wakeups.

Out of scope (deferred to P1): group-delete push, reactions push, payload metadata, multicast chunking above 500 tokens, FCM outcome metrics, fail-open Redis flag, dedicated push-token rotation endpoint.

## Changes

### 1. iOS push path is FCM-routes-to-APNS

**Files:** `docs/mobile-api-integration.md`, `src/devices/dto/register-device.dto.ts`.

The `PushPlatform` enum (`prisma/schema.prisma:79-83`) accepts `FCM | APNS | HMS`, but the only implemented provider is FCM (`src/push/push.module.ts`, `src/push/fcm.provider.ts`). Devices registered with `pushPlatform: 'APNS'` were filtered out at `src/push/queue/push-notification.processor.ts:88` and `:151` and received nothing.

**Resolution:** iOS clients must use `firebase_messaging` and register the FCM token it returns with `pushPlatform: 'FCM'`. FCM bridges to APNS under the hood as long as the iOS app's APNS Authentication Key is configured in the Firebase console. The `APNS` and `HMS` enum values are kept (validation accepts them) for forward compatibility, but the worker will not deliver to them. A code comment is added at the two filter sites in `push-notification.processor.ts` to make this explicit.

### 2. iOS new-message push headers

**File:** `src/push/queue/push-notification.processor.ts`.

The `sendFcmWakeup` method previously set only `apns.payload.aps.contentAvailable: true` and no `apns.headers`. iOS 13+ requires `apns-push-type` and `apns-priority` for reliable silent push delivery. The edit/delete path already had this; the new-message path did not.

**Resolution:** extract a shared `SILENT_APNS` constant at the top of the file and use it in both `sendFcmWakeup` and `sendSilentFcmWakeup`:

```ts
const SILENT_APNS = {
  payload: { aps: { contentAvailable: true } },
  headers: { 'apns-push-type': 'background' as const, 'apns-priority': '5' },
};
```

### 3. Online suppression via batched Redis presence check

**Files:** `src/redis/redis.service.ts`, `src/push/queue/push-notification.processor.ts`.

`RedisService.hasDeviceSocket(deviceId)` already existed but was never called from the push path. A naive `Promise.all` of 300 SCARD calls per push job (large group) would add unnecessary latency to the BullMQ worker.

**Resolution:**

- Add `getDevicesWithSockets(deviceIds: string[]): Promise<Set<string>>` to `RedisService`. It pipelines one SCARD per id and returns the set of online ids. One round-trip to Redis regardless of group size.
- Inject `RedisService` into `PushNotificationProcessor`.
- In both `sendFcmWakeup` and `sendSilentFcmWakeup`, after the FCM-platform filter, call a new private helper `filterOnlineDevices(candidates)` that uses `getDevicesWithSockets` and drops the online ones before calling FCM.

**Known tradeoff (P0):** if the Redis presence check rejects, the helper returns an empty `Set` (i.e. treats every device as online and skips the push). This trades push availability for cost correctness during a Redis outage. If Redis goes down for an hour, no push wakes go out for that hour. **P1 follow-up:** add `PUSH_FAIL_OPEN_ON_REDIS_DOWN` flag to flip the catch from `Set()` to "treat as all offline" and emit a metric on the divergence.

## Files Changed

| File | Reason |
|---|---|
| `src/redis/redis.service.ts` | New `getDevicesWithSockets` helper |
| `src/redis/redis.service.spec.ts` | New test file (4 cases) |
| `src/push/queue/push-notification.processor.ts` | Inject Redis, shared `SILENT_APNS`, `filterOnlineDevices` helper |
| `src/push/queue/push-notification.processor.spec.ts` | Add Redis mock, 3 new tests, update existing mocks |
| `src/devices/dto/register-device.dto.ts` | Inline comment about FCM-only delivery |
| `docs/mobile-api-integration.md` | Replace "Allowed push platforms" block with FCM-only wording + iOS bridge explanation |

## P1 Follow-ups (named, not implemented)

- `PUSH_FAIL_OPEN_ON_REDIS_DOWN` flag + divergence metric.
- FCM outcome metrics (`successCount`/`failureCount` per job, top error codes, latency histogram, `staleTokensCleared` counter).
- Payload metadata (`messageId`, `threadId`, `envelopeSequence`, `count`) so the client can `GET /messages/pending` with a hint instead of a full scan.
- Multicast chunking above 500 tokens (FCM's hard limit per `sendEachForMulticast`).
- Exponential backoff on the `push-notifications` job (`backoff: { type: 'exponential', delay: 10000 }`).
- `PUT /devices/:id/push-token` for clean FCM token rotation without re-sending identity keys.
- Reactions push policy (currently none).
- `pushActive` semantics — written but never read by the worker; either use it (per-device push toggle) or drop it.
- Group delete push (currently no wakeup; deliberate per current product call).

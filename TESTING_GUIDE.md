# Manual Testing Guide — Cross-Module Streamlining Changes

## Prerequisites

1. Start PostgreSQL locally (or ensure `DATABASE_URL` in `.env` points to a running DB)
2. Run migrations: `npx prisma migrate dev`
3. Start the server: `pnpm start:dev`
4. Have a valid JWT access token (register/login via `/auth` endpoints)

---

## 1. OTP Security (`src/auth/otp.service.ts`)

### 1.1 Request OTP — Verify Success
```bash
curl -X POST http://localhost:3000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+998901234567"}'
```
**Expected:** `{"success": true, "message": "OTP sent successfully", "expiresInSeconds": 300}`

### 1.2 Request OTP Again — Cooldown Block
```bash
curl -X POST http://localhost:3000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+998901234567"}'
```
**Expected:** `{"success": true, "message": "OTP already sent. Please wait before requesting a new one.", "canResendAt": "..."}`

### 1.3 Verify OTP — Wrong Code
```bash
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+998901234567", "code": "000000"}'
```
**Expected:** `403 Forbidden` — "Invalid OTP code"

### 1.4 Verify OTP — Max Attempts Lockout
Run 5 wrong attempts, then try again:
```bash
# Run 5 times:
for i in {1..5}; do
  curl -X POST http://localhost:3000/auth/verify-otp \
    -H "Content-Type: application/json" \
    -d '{"phone": "+998901234567", "code": "000000"}'
done

# 6th attempt (even with correct code):
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "+998901234567", "code": "<correct_code>"}'
```
**Expected:** After 5th wrong attempt, `403 Forbidden` — "Too many failed attempts..."

### 1.5 Security — Verify No Math.random()
```bash
grep -n "Math.random" src/auth/otp.service.ts
```
**Expected:** No matches. `generateOtpCode()` should use `randomDigits(6)` from `crypto.util.ts`.

---

## 2. Messages Service — Combined Device Query

### 2.1 Send Message — Success (Cacheless Path)
```bash
curl -X POST http://localhost:3000/messages/send \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "senderDeviceId": "<your-device-id>",
    "recipientUserId": "<other-user-id>",
    "idempotencyKey": "test-manual-001",
    "envelopes": [
      {"recipientDeviceId": "<recipient-device-id>", "ciphertext": {"body": "encrypted"}}
    ]
  }'
```
**Expected:** `201 Created` with message object including `id`, `threadSequence`, `envelopes`.

### 2.2 Send Message — Missing Envelope for Recipient Device
```bash
curl -X POST http://localhost:3000/messages/send \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "senderDeviceId": "<your-device-id>",
    "recipientUserId": "<other-user-id>",
    "idempotencyKey": "test-manual-002",
    "envelopes": []
  }'
```
**Expected:** `400 Bad Request` — "Missing envelope for active recipient device"

### 2.3 Send Message — Self-Message Blocked
```bash
curl -X POST http://localhost:3000/messages/send \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "senderDeviceId": "<your-device-id>",
    "recipientUserId": "<your-own-user-id>",
    "idempotencyKey": "test-manual-003",
    "envelopes": []
  }'
```
**Expected:** `400 Bad Request` — "Recipient must be another user"

### 2.4 Idempotency — Duplicate Key Returns Same Message
Run the same request from 2.1 again with the same `idempotencyKey`.
**Expected:** Same `messageId` as first request. No new message created.

---

## 3. Prekeys Service — Upload Cap

### 3.1 Refill Under Cap
```bash
curl -X POST http://localhost:3000/prekeys/refill \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "<your-device-id>",
    "prekeys": [
      {"keyId": 1, "publicKey": "pk1"},
      {"keyId": 2, "publicKey": "pk2"}
    ]
  }'
```
**Expected:** `{"inserted": 2}`

### 3.2 Refill Over Cap
First, fill up to near 500 prekeys (or temporarily lower `PREKEY_MAX_TOTAL` in `.env` to 5 for testing). Then:
```bash
curl -X POST http://localhost:3000/prekeys/refill \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "<your-device-id>",
    "prekeys": [
      {"keyId": 999, "publicKey": "pk999"}
    ]
  }'
```
**Expected:** `400 Bad Request` — "Prekey refill would exceed device limit..."

---

## 4. Users Service — Batch Limits & N+1 Fix

### 4.1 syncContacts — Batch Size Limit
```bash
curl -X POST http://localhost:3000/users/sync-contacts \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneHashes": ['$(python3 -c "import json; print(json.dumps(['h' + str(i) for i in range(1001)]))")']
  }'
```
**Expected:** `400 Bad Request` — "Contact batch too large. Max 1000 allowed."

### 4.2 syncContacts — Valid Batch
```bash
curl -X POST http://localhost:3000/users/sync-contacts \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"phoneHashes": ["hash1", "hash2"]}'
```
**Expected:** Array of matching active users.

### 4.3 getDeviceKeyBundles — No N+1
```bash
curl -X GET http://localhost:3000/users/device-key-bundles \
  -H "Authorization: Bearer <JWT_TOKEN>"
```
**Expected:** Returns bundles for all active devices. Check server logs or Prisma query logs to confirm only **one** `oneTimePrekey.findMany` + **one** `oneTimePrekey.updateMany` inside the transaction (not per-device queries).

---

## 5. Group Fanout Processor

### 5.1 Send Group Message — Queued
```bash
curl -X POST http://localhost:3000/groups/<group-id>/messages \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "senderDeviceId": "<your-device-id>",
    "idempotencyKey": "group-test-001",
    "ciphertext": {"body": "group-encrypted"}
  }'
```
**Expected:** `{"success": true, "messageId": "...", "queued": true}`

### 5.2 Idempotency — Duplicate
Run same request again.
**Expected:** `{"success": true, "messageId": "...", "queued": false}`

### 5.3 Verify Fanout
Check the BullMQ dashboard or worker logs. The job payload should include `threadSequence` and `createdAt`. Envelopes should be created for all group members **except** the sender's device.

---

## 6. GraphQL Pagination (Direct Threads & Groups)

### 6.1 Query Direct Threads — No Eager Messages
```graphql
query {
  directThreads(userId: "<your-user-id>") {
    id
    userAId
    userBId
    latestSequence
  }
}
```
**Expected:** Threads returned **without** messages field. No unbounded row loading.

### 6.2 Query Direct Threads — Paginated Messages
```graphql
query {
  directThreads(userId: "<your-user-id>") {
    id
    messages(limit: 10) {
      id
      threadSequence
      createdAt
    }
  }
}
```
**Expected:** Max 10 most recent messages per thread, ordered ascending by `threadSequence`.

### 6.3 Query Direct Threads — Cursor Pagination
```graphql
query {
  directThreads(userId: "<your-user-id>") {
    id
    messages(limit: 5, beforeSequence: 50) {
      id
      threadSequence
    }
  }
}
```
**Expected:** Messages with `threadSequence < 50`, max 5 results.

### 6.4 Query Groups — No Eager Messages
```graphql
query {
  groups(userId: "<your-user-id>") {
    id
    members { userId role }
  }
}
```
**Expected:** Groups returned without messages.

### 6.5 Query Group — Paginated Messages
```graphql
query {
  group(id: "<group-id>") {
    id
    messages(limit: 20, afterSequence: 10) {
      id
      threadSequence
      senderUserId
      createdAt
    }
  }
}
```
**Expected:** Messages with `threadSequence > 10`, max 20, ascending order.

### 6.6 Verify Resolver Default (No Args)
```graphql
query {
  directThreads(userId: "<your-user-id>") {
    id
    messages {
      id
    }
  }
}
```
**Expected:** 50 messages returned (default limit), ascending order.

---

## 7. Redis Cache Cleanup

### 7.1 Verify Cache Methods Removed
```bash
grep -n "getActiveDeviceIds\|setActiveDeviceIds\|invalidateActiveDeviceIds" src/redis/redis.service.ts
```
**Expected:** No matches (except possibly in comments/history).

### 7.2 Verify DevicesService Has No Redis Dependency
```bash
grep -n "redis\|RedisService" src/devices/devices.service.ts
```
**Expected:** No Redis imports or usage.

### 7.3 Verify MessagesService Has No Redis Dependency
```bash
grep -n "redis\|RedisService" src/messages/messages.service.ts
```
**Expected:** No Redis imports or usage.

---

## 8. Metrics Endpoint (Prometheus)

### 8.1 Check Metrics Exposed
```bash
curl http://localhost:3000/metrics
```
**Expected:** Prometheus-formatted metrics. Look for `redis_cache_operations_total` counter (or other default metrics).

---

## Database Verification

### Verify OTP Index
```sql
\d "Otp"
```
**Expected:** Index on `(phoneHash, status, createdAt)` exists.

### Verify No Orphan Envelopes
After sending group messages, check that `messageEnvelope` rows exist only for non-sender devices:
```sql
SELECT recipientDeviceId, status FROM "MessageEnvelope" WHERE "messageId" = '<msg-id>';
```

---

## Quick Regression Checklist

Run through these in ~5 minutes:

- [ ] Request OTP → success
- [ ] Verify OTP wrong code → 403
- [ ] Send direct message → 201
- [ ] Send same message again (idempotency) → same messageId
- [ ] Refill prekeys → inserted count
- [ ] syncContacts with 1001 hashes → 400
- [ ] GraphQL: `directThreads { messages(limit: 5) { id } }` → 5 messages
- [ ] GraphQL: `groups { messages(limit: 10) { id } }` → 10 messages
- [ ] Group message send → queued: true
- [ ] Metrics endpoint `/metrics` → returns Prometheus data

---

## Troubleshooting

**Problem:** `Can't reach database server`  
**Fix:** Ensure PostgreSQL is running and `DATABASE_URL` in `.env` is correct.

**Problem:** `JWT token invalid`  
**Fix:** Get a fresh token via `/auth/request-otp` → `/auth/verify-otp` → `/auth/login`.

**Problem:** GraphQL returns `messages` as null/empty  
**Fix:** Make sure the thread/group actually has messages. Use a thread/group ID you've sent messages to.

**Problem:** `createManyAndReturn` not available  
**Fix:** Ensure Prisma Client is regenerated: `npx prisma generate`

**Problem:** BullMQ worker not processing jobs  
**Fix:** Ensure Redis is running and the worker is started. In dev mode, the NestJS app starts the worker automatically via `@Processor` decorator.

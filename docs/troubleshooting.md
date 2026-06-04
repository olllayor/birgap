# Troubleshooting Guide

## Common Issues

### Server Won't Start

#### Error: `DATABASE_URL is not defined`

**Cause**: Missing environment variable.

**Solution**:
```bash
# Check .env file exists
ls -la .env

# Verify DATABASE_URL is set
grep DATABASE_URL .env

# Should be: DATABASE_URL=postgresql://user:pass@host:5432/birgap
```

---

#### Error: `connect ECONNREFUSED 127.0.0.1:5432`

**Cause**: PostgreSQL is not running.

**Solution**:
```bash
# Start PostgreSQL with Docker
docker compose up -d postgres

# Or check if PostgreSQL is running locally
pg_isready -h localhost -p 5432

# Start PostgreSQL service (macOS with Homebrew)
brew services start postgresql
```

---

#### Error: `connect ECONNREFUSED 127.0.0.1:6379`

**Cause**: Redis is not running.

**Solution**:
```bash
# Start Redis with Docker
docker compose up -d redis

# Or check if Redis is running
redis-cli ping
# Should return: PONG

# Start Redis service (macOS with Homebrew)
brew services start redis
```

**Redis Connection Resilience**:
The Redis client uses exponential backoff for reconnection (max 2s delay). Transient network errors (`ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, `EPIPE`) trigger automatic reconnection. Check server logs if Redis remains unreachable after recovery.

---

#### Error: `Invalid JWT secret: must be at least 24 characters`

**Cause**: `JWT_ACCESS_SECRET` is too short.

**Solution**:
```bash
# Generate a secure random string
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Update .env with the generated string
JWT_ACCESS_SECRET=<generated-string>
```

---

### Database Issues

#### Error: `PrismaClientInitializationError: Database not found`

**Cause**: Database doesn't exist.

**Solution**:
```bash
# Create database
createdb birgap

# Or with Docker PostgreSQL
docker compose exec postgres createdb -U postgres birgap

# Then run migrations
pnpm prisma:migrate
```

---

#### Error: `P2002: Unique constraint failed`

**Cause**: Duplicate data (e.g., duplicate idempotency key).

**Solution**: This is usually expected behavior. The application handles this gracefully for idempotent operations. If unexpected:

```bash
# Check Prisma logs
DEBUG=* pnpm start:dev

# Inspect database
npx prisma studio
```

---

#### Migrations Fail

**Cause**: Schema drift or conflicting migrations.

**Solution**:
```bash
# Check migration status
npx prisma migrate status

# If migrations are out of sync (development only!)
npx prisma migrate reset

# Reapply migrations
pnpm prisma:migrate
```

**Warning**: `migrate reset` destroys all data. Never use in production.

---

### Authentication Issues

#### Error: `401 Unauthorized: Invalid bearer token`

**Cause**: Access token expired or invalid.

**Solution**:
1. Check token expiration (default TTL: 15 minutes)
2. Refresh token: `POST /auth/refresh`
3. If refresh fails, re-authenticate: `POST /auth/otp/verify`

```bash
# Test with curl
curl http://localhost:3000/devices \
  -H "Authorization: Bearer <your-token>"
```

---

#### Error: `401 Unauthorized: Session is no longer active`

**Cause**: Refresh token was revoked or expired.

**Solution**: User must re-authenticate with OTP.

---

#### Error: `403 Forbidden: Device belongs to another user`

**Cause**: Trying to access another user's device.

**Solution**: Verify you're using the correct access token for the user who owns the device.

---

### WebSocket Issues

#### WebSocket Connection Fails

**Cause**: Invalid or expired ticket.

**Solution**:
```bash
# 1. Get fresh ticket
curl -X POST http://localhost:3000/realtime/token \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId": "your-device-uuid"}'

# 2. Use ticket immediately (TTL: 60 seconds)
```

**Debug**:
```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { ticket: 'your-ticket' },
  transports: ['websocket'],
});

socket.on('connect', () => console.log('Connected!'));
socket.on('connect_error', (err) => console.error('Connection error:', err.message));
socket.on('disconnect', (reason) => console.log('Disconnected:', reason));
```

---

#### WebSocket Disconnects Frequently

**Cause**: Network issues or server restart.

**Solution**:
- Implement reconnection logic in client
- Check server logs for crashes
- Verify ping/pong settings (default: 25s interval, 10s timeout)

```typescript
const socket = io('http://localhost:3000', {
  auth: { ticket },
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
});
```

---

### Message Issues

#### Error: `400 Bad Request: Missing envelope for active recipient device`

**Cause**: Not all recipient devices have envelopes.

**Solution**: Fetch recipient's active devices and create an envelope for each:

```typescript
// 1. Get recipient's devices
const keyBundles = await fetch(`/users/${recipientUserId}/devices/key-bundles`);
const { devices } = await keyBundles.json();

// 2. Create envelope for each device
const envelopes = devices.map(device => ({
  recipientDeviceId: device.deviceId,
  ciphertext: encryptMessage(device),
}));
```

---

#### Error: `404 Not Found: Recipient has no active devices`

**Cause**: Recipient hasn't registered a device or all devices deactivated.

**Solution**: Recipient must register at least one device before receiving messages.

---

#### Messages Not Delivered

**Cause**: WebSocket not connected or push notifications not configured.

**Solution**:
1. Check WebSocket connection status
2. Verify push token is registered for device
3. Fetch pending messages manually: `GET /messages/pending`

```bash
# Check pending messages
curl "http://localhost:3000/messages/pending?deviceId=<device-uuid>" \
  -H "Authorization: Bearer <access-token>"
```

---

#### Duplicate Messages

**Cause**: Idempotency key not being reused on retry.

**Solution**: Generate stable idempotency key and reuse on retry:

```typescript
// Generate once per logical message
const idempotencyKey = generateUUID();

// Retry with same key
async function sendMessageWithRetry(payload, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch('/messages', {
        method: 'POST',
        body: JSON.stringify({ ...payload, idempotencyKey }),
      });
    } catch (error) {
      if (i === maxRetries - 1) throw error;
    }
  }
}
```

---

### Prekey Issues

#### Error: `Low watermark reached`

**Cause**: One-time prekeys running low.

**Solution**: Refill prekeys automatically:

```typescript
const { oneTimePrekeysRemaining, lowWatermark } = await fetchPrekeyCount(deviceId);

if (lowWatermark) {
  await refillPrekeys(deviceId, generatePrekeys(100));
}
```

---

#### Error: `oneTimePrekey: null` in key bundle

**Cause**: Device has no unconsumed one-time prekeys.

**Solution**: This is expected. Client must support session initialization without one-time prekey (fallback to signed prekey only).

---

### Backup Issues

#### Error: `Size mismatch: expected X, got Y`

**Cause**: Uploaded blob size doesn't match declared size.

**Solution**: Verify blob size before uploading:

```typescript
const blob = encryptBackup();
const sizeBytes = blob.byteLength;

// Get upload URL with correct size
const { uploadUrl, bucketKey } = await getUploadUrl(sizeBytes);

// Upload blob
await fetch(uploadUrl, {
  method: 'PUT',
  body: blob,
  headers: { 'Content-Length': sizeBytes.toString() },
});

// Register backup
await registerBackup({ bucketKey, sha256: hash(blob), sizeBytes });
```

---

#### Error: `Failed to delete old backup object`

**Cause**: R2 permissions issue or object doesn't exist.

**Solution**: This is a warning, not a fatal error. Check R2 bucket permissions:

- Ensure R2 credentials have `DeleteObject` permission
- Verify bucket name is correct

---

### Push Notification Issues

#### Push Notifications Not Received

**Cause**: FCM not configured or push token invalid.

**Solution**:
```bash
# 1. Check push provider configuration
grep PUSH_PROVIDER .env
# Should be: PUSH_PROVIDER=fcm

# 2. Verify FCM credentials
grep FCM_SERVICE_ACCOUNT_JSON .env

# 3. Check device push token
curl http://localhost:3000/devices \
  -H "Authorization: Bearer <access-token>"
# Should show pushToken and pushPlatform
```

**Debug**: Set `PUSH_PROVIDER=logger` to see push attempts in server logs.

---

#### Error: `FCM send failed: messaging/registration-token-not-registered`

**Cause**: Push token is stale.

**Solution**: Application automatically clears stale tokens. Client should re-register push token:

```typescript
// Re-register device with new push token
await fetch('/devices/register', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: currentDeviceId,
    pushToken: newFcmToken,
    pushPlatform: 'FCM',
    pushActive: true,
  }),
});
```

---

### Performance Issues

#### Slow API Responses

**Cause**: Database connection pool exhaustion, slow queries, or missing connection pooler in production.

**Solution**:
```bash
# Check database connections
docker compose exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
docker compose exec postgres psql -U postgres -c "SELECT * FROM pg_stat_activity WHERE state = 'active';"

# Verify connection_limit is set in DATABASE_URL
grep connection_limit .env
# Should show: connection_limit=10 (or your configured value)

# Restart application if needed
pm2 restart birgap
```

**Prevention**:
- Development: set `connection_limit=10` in `DATABASE_URL`
- Production: use PgBouncer or Supavisor (see [Deployment Guide](./deployment.md#connection-pooling))

---

#### High Memory Usage

**Cause**: Memory leak or large payload processing.

**Solution**:
```bash
# Check memory usage
pm2 monit

# Restart if memory exceeds threshold
pm2 restart birgap

# Enable heap snapshots for debugging
NODE_OPTIONS="--max-old-space-size=4096 --heapsnapshot-signal=SIGUSR2" node dist/main.js
```

---

### CORS Issues

#### Error: `Access to XMLHttpRequest blocked by CORS policy`

**Cause**: CORS not configured correctly.

**Solution**: Update CORS configuration in `main.ts`:

```typescript
app.enableCors({
  origin: ['https://app.birgap.com'],
  credentials: true,
});
```

For WebSocket, CORS is configured in `realtime.gateway.ts`:
```typescript
@WebSocketGateway({
  cors: { origin: true, credentials: true },
})
```

---

## Debugging Tools

### Enable Debug Logging

```env
NODE_ENV=development
```

### Prisma Query Logging

Edit `prisma/prisma.service.ts`:
```typescript
this.prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});
```

### Inspect Database

```bash
# Open Prisma Studio (GUI)
npx prisma studio

# Or use psql directly
psql -U postgres -d birgap
```

### View Server Logs

```bash
# Development logs
pnpm start:dev

# PM2 logs
pm2 logs birgap

# Docker logs
docker compose logs -f app
```

### Test Endpoints

```bash
# Using curl
curl -X POST http://localhost:3000/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1234567890"}'

# Using httpie
http POST http://localhost:3000/auth/otp/request phone="+1234567890"
```

### Check Health

```bash
curl http://localhost:3000/health

# Expected: {"status":"ok","info":{"postgres":{"status":"up"},"redis":{"status":"up"}}}
```

---

## Error Code Reference

| HTTP Code | Common Causes | Solution |
|-----------|---------------|----------|
| 400 | Invalid input, missing envelopes | Check request body and validation |
| 401 | Expired/invalid token | Refresh token or re-authenticate |
| 403 | Wrong device ownership | Verify token matches device owner |
| 404 | Resource not found | Check resource exists and is accessible |
| 409 | Max devices reached | Deactivate old device first |
| 429 | Rate limit exceeded | Wait and retry (auth: 5/min, default: 60/min) |
| 500 | Server error | Check server logs |
| 503 | Health check failed | Check database/redis connectivity |

---

## Getting Help

1. Check this troubleshooting guide
2. Review server logs for error messages
3. Verify environment configuration
4. Test with health check endpoint
5. Check database connectivity
6. Review API documentation for correct request format

### Log Locations

- **Development**: Console output
- **PM2**: `~/.pm2/logs/birgap-out.log`
- **Docker**: `docker compose logs app`

### Useful Commands

```bash
# Full system check
docker compose ps
pnpm test
curl http://localhost:3000/health
npx prisma migrate status
redis-cli ping

# Reset development environment
docker compose down -v
docker compose up -d
pnpm prisma:migrate
pnpm start:dev
```

# Deployment Guide

## Production Requirements

### Infrastructure

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| Memory | 1 GB | 2 GB |
| Disk | 10 GB | 20 GB |
| PostgreSQL | 14+ | 15+ |
| Redis | 6+ | 7+ |

### External Services

- **PostgreSQL**: Managed database (e.g., AWS RDS, Supabase, Neon)
- **Redis**: Managed cache (e.g., AWS ElastiCache, Upstash)
- **Cloudflare R2**: S3-compatible object storage for backups
- **FCM**: Firebase Cloud Messaging for push notifications (optional)

## Environment Configuration

### Production `.env`

```env
# Application
NODE_ENV=production
PORT=3000
APP_ORIGIN=https://api.birgap.com

# Database
DATABASE_URL=postgresql://user:password@host:5432/birgap?schema=public&sslmode=require

# Redis
REDIS_URL=rediss://:password@host:6379

# JWT
JWT_ACCESS_SECRET=<generate-secure-random-string-min-24-chars>
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30

# WebSocket
WEBSOCKET_TICKET_TTL_SECONDS=60

# OTP (replace with real SMS provider in production)
OTP_MODE=mock
OTP_MOCK_CODE=000000
OTP_TTL_SECONDS=300

# Devices
MAX_ACTIVE_DEVICES=3
SIGNED_PREKEY_ROTATION_DAYS=7

# Push Notifications
PUSH_PROVIDER=fcm
FCM_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Cloudflare R2
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<access-key>
R2_SECRET_ACCESS_KEY=<secret-key>
R2_BUCKET_NAME=birgap-backups
R2_PRESIGNED_PUT_TTL_SECONDS=900
R2_PRESIGNED_GET_TTL_SECONDS=300

# Moderation / Admin Dashboard
# Comma-separated SHA-256 hashes of E.164 phone numbers. Each matching user is
# promoted to ADMIN on app start. Idempotent. Empty string disables.
ADMIN_PHONE_HASHES=
# Public URL for the "appeal suspension" page, surfaced in the 403 body when a
# suspended user hits any endpoint. Omit if you don't have one.
SUSPENSION_APPEAL_URL=https://example.com/appeal
# Per-user report cap, per UTC day. USER only; MOD/ADMIN exempt.
REPORTS_DAILY_LIMIT=50
# Per-client-IP report cap, per UTC minute. USER only. Set TRUST_PROXY_HOPS
# below to your actual hop count so req.ip is the real client IP behind a load
# balancer. NEVER set TRUST_PROXY_HOPS higher than the real hop count.
REPORTS_PER_IP_PER_MINUTE=10
REPORTS_COLLUSION_THRESHOLD=10
REPORTS_COLLUSION_WINDOW_HOURS=1
# Prune retention (days). AdminAuditLog is NEVER pruned.
REPORT_RETENTION_DAYS=365
DAILY_METRICS_RETENTION_DAYS=365
# Number of trusted reverse-proxy hops. 0 means do NOT trust X-Forwarded-For.
TRUST_PROXY_HOPS=1
```

### Security Checklist

- [ ] Generate strong `JWT_ACCESS_SECRET` (min 24 chars, random)
- [ ] Use SSL for database connection (`sslmode=require`)
- [ ] Use SSL for Redis connection (`rediss://`)
- [ ] Set `NODE_ENV=production`
- [ ] Configure proper CORS origins (not `*`)
- [ ] Replace mock OTP with real SMS provider
- [ ] Set up FCM service account for push notifications
- [ ] Configure R2 bucket with proper permissions
- [ ] Set up HTTPS/TLS termination
- [ ] Enable firewall rules (only expose necessary ports)
- [ ] Bootstrap at least one admin via `ADMIN_PHONE_HASHES` **or** `pnpm admin:promote`
- [ ] Set `TRUST_PROXY_HOPS` to the actual number of trusted reverse-proxy hops
- [ ] Run the DBA hardening: `REVOKE INSERT, UPDATE, DELETE ON "AdminAuditLog" FROM <app_role>`

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm prisma:generate

FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 3000

CMD ["node", "dist/main.js"]
```

### Docker Compose (Production)

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    depends_on:
      - pgbouncer
      - redis
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: birgap
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  pgbouncer:
    image: pgbouncer/pgbouncer:1.23
    environment:
      DATABASES_HOST: postgres
      DATABASES_PORT: 5432
      DATABASES_DATABASE: birgap
      DATABASES_USER: ${POSTGRES_USER}
      DATABASES_PASSWORD: ${POSTGRES_PASSWORD}
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 1000
      DEFAULT_POOL_SIZE: 20
      RESERVE_POOL_SIZE: 5
    ports:
      - "6543:5432"
    depends_on:
      - postgres
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

## Deployment Steps

### 1. Build Application

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Generate Prisma client
pnpm prisma:generate

# Build
pnpm build
```

### 2. Run Database Migrations

```bash
# Deploy migrations (non-interactive, safe for production)
pnpm prisma:deploy
```

**Important**: Use `prisma:deploy` in production, NOT `prisma:migrate` (which is interactive).

### 3. Start Application

```bash
# Using PM2 (recommended for Node.js)
pm2 start dist/main.js --name birgap -i max

# Or with Docker
docker compose up -d
```

### 4. Verify Deployment

```bash
# Health check
curl https://api.birgap.com/health

# Expected response:
# {"status":"ok","info":{"postgres":{"status":"up"},"redis":{"status":"up"}}}
```

## Reverse Proxy Configuration

### Nginx

```nginx
server {
    listen 80;
    server_name api.birgap.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.birgap.com;

    ssl_certificate /etc/letsencrypt/live/api.birgap.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.birgap.com/privkey.pem;

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # REST API
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy

```caddy
api.birgap.com {
    reverse_proxy localhost:3000
}
```

Caddy automatically handles WebSocket upgrades and TLS.

## Database Management

### Backup Strategy

```bash
# PostgreSQL backup
pg_dump -U postgres birgap > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
psql -U postgres birgap < backup_20260516_100000.sql
```

### Migration Strategy

```bash
# Always test migrations in staging first
# Deploy migrations before deploying application code
pnpm prisma:deploy

# Verify migration
npx prisma migrate status
```

### Moderation Module Migration Order

The moderation module deploys as four additive migrations that must be applied in order, with a one-time backfill script between migration 1 and migration 2:

```bash
# 1. Apply migration A — additive only (new tables, new enums, User.role)
pnpm prisma:deploy
# New code starts writing to AdminAuditLog; old code keeps writing to MessageAdminDeleteLog.

# 2. Backfill legacy rows (idempotent, re-runnable)
pnpm admin:backfill-audit
# Verifies every MessageAdminDeleteLog row is mirrored into AdminAuditLog
# with metadata.source='legacy' and metadata.originalId=<legacy row id>.

# 3. Apply migration B — drops MessageAdminDeleteLog
pnpm prisma:deploy
# Code path in messages.service.ts:895-902 now writes only to AdminAuditLog.

# 4. Apply migration C — adds 'METRICS_ROLLUP' to AdminAuditAction
pnpm prisma:deploy
# Online: ALTER TYPE ... ADD VALUE does not rewrite the table.

# 5. Apply migration D — User.strikeCount, User.lastStrikeAt, 'STRIKE_RESET'
pnpm prisma:deploy
```

**DBA hardening step (manual, after the migrations are applied):**

```sql
REVOKE INSERT, UPDATE, DELETE ON "AdminAuditLog" FROM <app_role>;
-- App retains SELECT + INSERT only. SELECT for /admin/audit-log read,
-- INSERT for AuditLogService.write. No application code can UPDATE or DELETE.
```

This is a defense-in-depth measure: even with app-level RCE, an attacker cannot tamper with the audit log because the DB role lacks the grant.

### Connection Pooling

Prisma has a built-in connection pool, but under load with multiple app instances the total connections can exhaust PostgreSQL's `max_connections`. Use an external pooler for production.

**Layer 1: Prisma connection pool** (per instance):
- Default size: `num_cpus * 2 + 1`
- Override with `connection_limit` in `DATABASE_URL`
- Recommended: `5–10` per instance when using an external pooler

**Layer 2: External pooler** (shared across all instances):

| Pooler | Mode | Notes |
|--------|------|-------|
| **PgBouncer** | Transaction | Fast, lightweight; requires `pgbouncer=true` in Prisma URL |
| **Supavisor** | Transaction | Supabase-native; set `pgbouncer=true` |
| **AWS RDS Proxy** | Session | Managed; no `pgbouncer=true` needed |

**Production `DATABASE_URL` with PgBouncer:**
```env
DATABASE_URL=postgresql://user:pass@pooler:6543/birgap?schema=public&pgbouncer=true&connection_limit=10
```

**Sizing formula:**
```
PgBouncer DEFAULT_POOL_SIZE ≤ PostgreSQL max_connections × 0.8
Prisma connection_limit × number of app instances ≤ PgBouncer MAX_CLIENT_CONN
```

The whole point of a transaction-mode pooler is that `DEFAULT_POOL_SIZE` (real
PG connections) can be much smaller than the sum of Prisma client connections,
because short-lived transactions multiplex over the pool. `MAX_CLIENT_CONN`
caps how many client-side sockets PgBouncer accepts and must be ≥ total Prisma
connections, while `DEFAULT_POOL_SIZE` is sized to PostgreSQL's headroom.

Example for 4 instances:
- Prisma `connection_limit=10` per instance → 40 total client sockets
- PgBouncer `MAX_CLIENT_CONN=100` → comfortably above 40
- PgBouncer `DEFAULT_POOL_SIZE=20` → 20 real PG connections multiplexed
- PostgreSQL `max_connections=100` → plenty of headroom

## Monitoring

### Health Check Endpoint

```bash
GET /health
```

Configure monitoring tools to poll this endpoint every 30-60 seconds.

### Prometheus Metrics (Future)

Consider adding:
- Request latency
- Error rates
- Active WebSocket connections
- Database connection pool usage
- Message throughput

### Logging

Production logs should include:
- Request ID for tracing
- User ID (for authenticated requests)
- Device ID (for device-specific operations)
- Error stack traces (server-side only)

**Do NOT log**:
- Access tokens
- Refresh tokens
- Phone numbers
- Message content
- Ciphertext payloads

### Log Aggregation

Recommended tools:
- **Datadog**: Full observability platform
- **Grafana Loki**: Log aggregation with Grafana
- **AWS CloudWatch**: AWS-native logging
- **Papertrail**: Simple log management

## Scaling

### Horizontal Scaling

BirGap can scale horizontally with:

1. **Load Balancer**: Distribute traffic across instances
2. **Shared Database**: Single PostgreSQL instance
3. **Shared Redis**: Single Redis cluster for socket routing
4. **Sticky Sessions**: NOT required (stateless API)

**WebSocket Consideration**: With multiple instances, Redis is used for device-to-socket mapping. Ensure all instances connect to the same Redis cluster.

### Vertical Scaling

Increase resources for:
- High message throughput
- Large number of concurrent WebSocket connections
- Heavy backup upload/download traffic

### Database Scaling

- **Read Replicas**: For read-heavy workloads (key bundle fetches)
- **Connection Pooling**: For high connection counts
- **Partitioning**: For large message tables (future)

## CI/CD Pipeline

### GitHub Actions Example

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 10.33.0

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Deploy
        run: |
          # SSH to server and deploy
          ssh ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} << 'EOF'
            cd /opt/birgap
            git pull
            pnpm install --frozen-lockfile
            pnpm prisma:deploy
            pnpm build
            pm2 restart birgap
          EOF
```

## Rollback Strategy

### Application Rollback

```bash
# List PM2 processes
pm2 list

# Rollback to previous version
cd /opt/birgap
git checkout <previous-commit>
pnpm install --frozen-lockfile
pnpm build
pm2 restart birgap
```

### Database Rollback

```bash
# Check migration status
npx prisma migrate status

# Rollback last migration (use with caution!)
npx prisma migrate resolve --rolled-back <migration-name>
```

**Warning**: Database rollbacks can cause data loss. Always backup before migrating.

## Disaster Recovery

### Backup Schedule

- **Database**: Daily automated backups
- **R2 Backups**: Already replicated by Cloudflare
- **Configuration**: Version control `.env` template (not secrets)

### Recovery Steps

1. Provision new server
2. Restore database from backup
3. Deploy application
4. Run migrations
5. Verify health checks
6. Update DNS if needed

## Graceful Shutdown

The application handles `SIGTERM` and `SIGINT` signals to ensure clean shutdown:

1. **BullMQ workers** drain in-flight jobs before exiting
2. **Prisma** disconnects from PostgreSQL cleanly
3. **Redis** connections are closed
4. **WebSocket gateway** notifies connected clients and cleans up Redis socket mappings

In Docker/Kubernetes, the container receives `SIGTERM` when stopped. The default timeout is handled by the orchestrator — ensure it's at least 10-15 seconds to allow in-flight requests to complete.

```bash
# Test graceful shutdown locally
kill -SIGTERM <pid>
```

## Performance Tuning

### Node.js

```bash
# Increase max old space size for large workloads
NODE_OPTIONS="--max-old-space-size=4096" node dist/main.js
```

### PostgreSQL

```sql
-- Increase connection limit
ALTER SYSTEM SET max_connections = 200;

-- Tune shared buffers (25% of RAM)
ALTER SYSTEM SET shared_buffers = '512MB';

-- Effective cache size (75% of RAM)
ALTER SYSTEM SET effective_cache_size = '1536MB';
```

### Redis

```conf
# Increase max memory
maxmemory 2gb

# Eviction policy — MUST be noeviction for BullMQ queue safety.
# allkeys-lru will silently evict queued jobs when memory pressure hits,
# causing message delivery holes with no error or retry.
maxmemory-policy noeviction
```

> **Warning:** If you share this Redis instance with application caches
> (session store, rate limiter, etc.), those caches will start returning
> errors when Redis hits `maxmemory` under `noeviction`. For production,
> use a **separate Redis instance** (or at minimum a separate Redis DB)
> for BullMQ queues vs. cache data. Queue Redis needs `noeviction`;
> cache Redis can use `allkeys-lru`.

## Security Hardening

### Firewall Rules

```bash
# Allow only necessary ports
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (redirect to HTTPS)
ufw allow 443/tcp   # HTTPS
ufw enable
```

### SSL/TLS

- Use Let's Encrypt for free certificates
- Enable HTTP/2
- Disable old TLS versions (< 1.2)
- Enable HSTS headers

### Rate Limiting

Already configured in application:
- Auth endpoints: 5 req/min
- Default endpoints: 60 req/min

Consider adding infrastructure-level rate limiting (e.g., Cloudflare, AWS WAF).

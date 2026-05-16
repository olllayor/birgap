# Developer Onboarding Guide

## Prerequisites

- **Node.js** >= 18.x
- **pnpm** >= 10.x (package manager)
- **Docker** & **Docker Compose** (for local Postgres and Redis)
- **PostgreSQL** client tools (optional, for direct DB access)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd BirGap
pnpm install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your configuration. For local development, the defaults work:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/birgap?schema=public
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=your-super-secret-key-at-least-24-chars
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=30
WEBSOCKET_TICKET_TTL_SECONDS=60
OTP_MODE=mock
OTP_MOCK_CODE=000000
OTP_TTL_SECONDS=300
MAX_ACTIVE_DEVICES=3
SIGNED_PREKEY_ROTATION_DAYS=7
PUSH_PROVIDER=logger
R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=birgap-backups
R2_PRESIGNED_PUT_TTL_SECONDS=900
R2_PRESIGNED_GET_TTL_SECONDS=300
```

### 3. Start Infrastructure

```bash
docker compose up -d
```

This starts:
- PostgreSQL on port 5432
- Redis on port 6379

### 4. Run Database Migrations

```bash
pnpm prisma:migrate
```

This creates all database tables and indexes.

### 5. (Optional) Seed Development Data

```bash
pnpm prisma:seed
```

### 6. Start Development Server

```bash
pnpm start:dev
```

Server runs at `http://localhost:3000`.

### 7. Verify Setup

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "info": {
    "postgres": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```

## Development Workflow

### Running the Server

```bash
# Development mode with hot reload
pnpm start:dev

# Production build
pnpm build
pnpm start:prod
```

### Database Operations

```bash
# Generate Prisma client (run after schema changes)
pnpm prisma:generate

# Create and apply migration
pnpm prisma:migrate

# Deploy migrations (for production, no prompts)
pnpm prisma:deploy

# Reset database (destroys all data)
npx prisma migrate reset

# Open Prisma Studio (GUI for database)
npx prisma studio
```

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# With coverage
pnpm test:cov
```

### Linting

```bash
pnpm lint
```

## Project Structure

```
BirGap/
├── src/
│   ├── main.ts                  # Application entry point
│   ├── app.module.ts            # Root module
│   ├── auth/                    # Authentication module
│   │   ├── auth.controller.ts   # REST endpoints
│   │   ├── auth.service.ts      # Business logic
│   │   ├── auth.module.ts       # Module definition
│   │   └── dto/                 # Request validation DTOs
│   ├── messages/                # Message relay module
│   ├── devices/                 # Device management module
│   ├── prekeys/                 # Cryptographic key management
│   ├── realtime/                # WebSocket gateway
│   ├── backups/                 # Encrypted backup storage
│   ├── push/                    # Push notification service
│   ├── users/                   # User lookup and key bundles
│   ├── health/                  # Health check endpoints
│   ├── storage/                 # Cloudflare R2/S3 integration
│   ├── redis/                   # Redis connection service
│   ├── prisma/                  # Prisma database service
│   └── common/                  # Shared utilities
│       ├── config/              # Environment validation
│       ├── guards/              # JWT authentication guard
│       ├── decorators/          # Custom decorators
│       ├── types/               # TypeScript types
│       ├── utils/               # Utility functions
│       └── filters/             # Exception filters
├── prisma/
│   ├── schema.prisma            # Database schema
│   ├── migrations/              # Migration files
│   └── seed.ts                  # Development seed data
├── docs/                        # Documentation
├── test/                        # Test files
├── docker-compose.yml           # Local infrastructure
├── package.json
├── tsconfig.json
└── nest-cli.json
```

## Module Creation Pattern

When adding a new module, follow this structure:

```bash
# Generate a new module with NestJS CLI
npx nest generate module modules/<name>
npx nest generate controller modules/<name>
npx nest generate service modules/<name>
```

Standard module files:
- `<name>.module.ts` - Module definition with imports/exports
- `<name>.controller.ts` - REST endpoints with Swagger decorators
- `<name>.service.ts` - Business logic
- `dto/` - Request validation DTOs using `class-validator`

## Adding API Endpoints

### Controller Pattern

```typescript
@ApiTags('resource-name')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('resource-name')
export class ResourceController {
  constructor(private readonly service: ResourceService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDto) {
    return this.service.create(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.findAll(user.userId);
  }
}
```

### DTO Pattern

```typescript
import { IsString, IsOptional, Length } from 'class-validator';

export class CreateDto {
  @IsString()
  @Length(8, 128)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
```

## Adding WebSocket Events

In `realtime.gateway.ts`:

```typescript
@SubscribeMessage('event.name')
handleEvent(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() body: EventDto,
) {
  if (!client.data.userId) return;
  
  // Emit to specific user/device room
  this.server.to(`user:${body.targetUserId}`).emit('event.response', {
    userId: client.data.userId,
    deviceId: client.data.deviceId,
  });
}
```

## Adding Database Models

1. Edit `prisma/schema.prisma`
2. Run `pnpm prisma:migrate` to create migration
3. Run `pnpm prisma:generate` to update Prisma client

## Debugging

### Enable Debug Logging

```env
NODE_ENV=development
```

### Prisma Query Logging

```env
DATABASE_URL=postgresql://...?schema=public
# Add to Prisma client initialization:
# log: ['query', 'info', 'warn', 'error']
```

### View Logs

```bash
# Server logs
pnpm start:dev

# Docker logs
docker compose logs -f postgres
docker compose logs -f redis
```

## Common Development Tasks

### Test Authentication Flow

```bash
# 1. Request OTP
curl -X POST http://localhost:3000/auth/otp/request \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1234567890"}'

# 2. Verify OTP (use OTP_MOCK_CODE from .env)
curl -X POST http://localhost:3000/auth/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1234567890", "code": "000000"}'

# 3. Use returned accessToken for protected endpoints
curl http://localhost:3000/devices \
  -H "Authorization: Bearer <accessToken>"
```

### Test WebSocket Connection

```typescript
import { io } from 'socket.io-client';

// 1. Get ticket
const tokenResp = await fetch('http://localhost:3000/realtime/token', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ deviceId: 'your-device-uuid' }),
});
const { ticket } = await tokenResp.json();

// 2. Connect with ticket
const socket = io('http://localhost:3000', {
  auth: { ticket },
  transports: ['websocket'],
});

socket.on('connect', () => console.log('Connected!'));
socket.on('message.new', (envelope) => console.log('New message:', envelope));
```

## Code Conventions

### TypeScript
- Strict mode enabled
- No implicit any
- Use interfaces for DTOs, types for unions

### Naming
- Controllers: `*Controller` suffix
- Services: `*Service` suffix
- DTOs: `*Dto` suffix
- Files: kebab-case (`auth.service.ts`)

### Error Handling
- Use NestJS built-in exceptions (`BadRequestException`, `NotFoundException`, etc.)
- Custom error messages for client clarity
- Log sensitive errors server-side only

### Validation
- All inputs validated with `class-validator`
- Use DTOs for request bodies
- Use query DTOs for query parameters

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Commit changes
git add .
git commit -m "feat: description of change"

# Push and create PR
git push origin feature/your-feature-name
```

### Commit Message Convention

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Maintenance tasks

## Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [Mobile API Integration Guide](./mobile-api-integration.md)
- [WebSocket Events Contract](./websocket-events.md)
- [Architecture Overview](./architecture.md)

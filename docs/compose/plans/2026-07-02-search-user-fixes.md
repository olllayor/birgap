# Search User Flow Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 issues in the user search flow: missing prefix index, sensitive data leakage, no self-exclusion, race condition on username update, no rate limiting, and fragile enum usage.

**Architecture:** Targeted fixes to existing files — no new modules or services. Each task is self-contained and testable.

**Tech Stack:** NestJS, Prisma, PostgreSQL, @nestjs/throttler, Jest

---

### Task 1: Add username prefix index to Prisma schema

**Covers:** Issue #1 (no prefix index for startsWith queries)

**Files:**
- Modify: `prisma/schema.prisma:157-158`

- [ ] **Step 1: Add the index**

In `prisma/schema.prisma`, add a prefix index on `username` inside the `User` model (after the existing `@@index([role])`):

```prisma
  @@index([role])
  @@index([username])
}
```

- [ ] **Step 2: Generate Prisma client and create migration**

Run:
```bash
npx prisma generate && npx prisma migrate dev --name add-username-index
```

Expected: Migration created, client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "fix: add username prefix index for search performance"
```

---

### Task 2: Remove sensitive fields from search response

**Covers:** Issue #2 (encryptedProfile and profileKeyHash leakage)

**Files:**
- Modify: `src/users/users.service.ts:174-180`
- Modify: `src/users/users.service.spec.ts:169-175`

- [ ] **Step 1: Write the failing test**

In `src/users/users.service.spec.ts`, update the existing `searchByUsername` test to assert the response does NOT include `encryptedProfile` or `profileKeyHash`:

```typescript
    it('finds active users by startsWith match', async () => {
      const mockResult = [{ id: 'user-1', username: 'alice_smith', profileAvatarUrl: null }];
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue(mockResult) },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      const result = await service.searchByUsername('ali');
      expect(result).toEqual(mockResult);
      expect(result[0]).not.toHaveProperty('encryptedProfile');
      expect(result[0]).not.toHaveProperty('profileKeyHash');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          username: {
            startsWith: 'ali',
            mode: 'insensitive',
          },
          status: 'ACTIVE',
        },
        take: 10,
        select: {
          id: true,
          username: true,
          profileAvatarUrl: true,
        },
      });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/users.service.spec.ts --testNamePattern="searchByUsername" --verbose`
Expected: FAIL — select still includes `encryptedProfile` and `profileKeyHash`.

- [ ] **Step 3: Fix the service**

In `src/users/users.service.ts`, update the `searchByUsername` select (lines 174-180):

```typescript
      select: {
        id: true,
        username: true,
        profileAvatarUrl: true,
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/users/users.service.spec.ts --testNamePattern="searchByUsername" --verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "fix: remove encryptedProfile and profileKeyHash from search response"
```

---

### Task 3: Add self-exclusion to search

**Covers:** Issue #3 (users see themselves in search results)

**Files:**
- Modify: `src/users/users.controller.ts:37-40`
- Modify: `src/users/users.service.ts:161-182`
- Modify: `src/users/users.service.spec.ts:146-178`

- [ ] **Step 1: Write the failing test**

In `src/users/users.service.spec.ts`, add a new test inside the `searchByUsername` describe block:

```typescript
    it('excludes the requesting user from results', async () => {
      const mockResult = [
        { id: 'user-1', username: 'alice' },
        { id: 'user-2', username: 'alice_wonder' },
      ];
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue(mockResult) },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await service.searchByUsername('alice', 'user-1');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          username: {
            startsWith: 'alice',
            mode: 'insensitive',
          },
          status: 'ACTIVE',
          id: { not: 'user-1' },
        },
        take: 10,
        select: {
          id: true,
          username: true,
          profileAvatarUrl: true,
        },
      });
    });

    it('returns all results when currentUserId is not provided', async () => {
      const mockResult = [{ id: 'user-1', username: 'alice' }];
      const prisma = {
        user: { findMany: jest.fn().mockResolvedValue(mockResult) },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await service.searchByUsername('alice');
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          username: {
            startsWith: 'alice',
            mode: 'insensitive',
          },
          status: 'ACTIVE',
        },
        take: 10,
        select: {
          id: true,
          username: true,
          profileAvatarUrl: true,
        },
      });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/users.service.spec.ts --testNamePattern="searchByUsername" --verbose`
Expected: FAIL — service doesn't accept or use `currentUserId`.

- [ ] **Step 3: Update the service signature and query**

In `src/users/users.service.ts`, update `searchByUsername`:

```typescript
  async searchByUsername(usernameQuery: string, currentUserId?: string) {
    if (!usernameQuery || usernameQuery.trim().length < 3) {
      throw new BadRequestException('Search query must be at least 3 characters');
    }
    return this.prisma.user.findMany({
      where: {
        username: {
          startsWith: usernameQuery,
          mode: 'insensitive',
        },
        status: 'ACTIVE',
        ...(currentUserId && { id: { not: currentUserId } }),
      },
      take: 10,
      select: {
        id: true,
        username: true,
        profileAvatarUrl: true,
      },
    });
  }
```

- [ ] **Step 4: Update the controller to pass current user**

In `src/users/users.controller.ts`, update the search endpoint:

```typescript
  @Get('search')
  searchByUsername(
    @Query('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.searchByUsername(username, user.userId);
  }
```

Also add the import for `AuthenticatedUser`:

```typescript
import { AuthenticatedUser } from '../common/types/authenticated-user';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/users/users.service.spec.ts --testNamePattern="searchByUsername" --verbose`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/users/users.service.ts src/users/users.controller.ts src/users/users.service.spec.ts
git commit -m "fix: exclude requesting user from search results"
```

---

### Task 4: Handle username update race condition

**Covers:** Issue #6 (concurrent username updates cause unhandled 500)

**Files:**
- Modify: `src/users/users.service.ts:128-159`
- Modify: `src/users/users.service.spec.ts:93-143`

- [ ] **Step 1: Write the failing test**

In `src/users/users.service.spec.ts`, add a test inside the `updateProfile` describe block:

```typescript
    it('throws BadRequestException on unique constraint violation (race condition)', async () => {
      const prismaError = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['username'] },
      });
      const prisma = {
        user: {
          findFirst: jest.fn().mockResolvedValue(null),
          update: jest.fn().mockRejectedValue(prismaError),
        },
      };
      const service = new UsersService(prisma as unknown as PrismaService);

      await expect(
        service.updateProfile('user-1', { username: 'race_condition_user' })
      ).rejects.toThrow(BadRequestException);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/users/users.service.spec.ts --testNamePattern="updateProfile" --verbose`
Expected: FAIL — P2002 error propagates as unhandled.

- [ ] **Step 3: Wrap update in try/catch**

In `src/users/users.service.ts`, update `updateProfile` to catch P2002:

```typescript
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.username) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          username: { equals: dto.username, mode: 'insensitive' },
          id: { not: userId },
        },
      });
      if (existingUser) {
        throw new BadRequestException('Username is already taken');
      }
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.username !== undefined && { username: dto.username }),
          ...(dto.profileAvatarUrl !== undefined && { profileAvatarUrl: dto.profileAvatarUrl }),
          ...(dto.encryptedProfile !== undefined && { encryptedProfile: dto.encryptedProfile as Prisma.InputJsonValue }),
          ...(dto.profileKeyHash !== undefined && { profileKeyHash: dto.profileKeyHash }),
        },
        select: {
          id: true,
          phoneHash: true,
          username: true,
          profileAvatarUrl: true,
          encryptedProfile: true,
          profileKeyHash: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('Username is already taken');
      }
      throw error;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/users/users.service.spec.ts --testNamePattern="updateProfile" --verbose`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/users/users.service.ts src/users/users.service.spec.ts
git commit -m "fix: catch P2002 race condition on username update"
```

---

### Task 5: Add rate limiting to search endpoint

**Covers:** Issue #5 (no rate limiting enables enumeration)

**Files:**
- Modify: `src/users/users.controller.ts:1-8, 37-40`

- [ ] **Step 1: Add @Throttle decorator to search endpoint**

In `src/users/users.controller.ts`, add the `Throttle` import and decorator:

```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { UsersService } from './users.service';
import { SyncContactsDto } from './dto/sync-contacts.dto';
import { UpdateProfileDto } from './dto/profile.dto';
```

Then add the decorator to the search method:

```typescript
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('search')
  searchByUsername(
    @Query('username') username: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.searchByUsername(username, user.userId);
  }
```

This allows 30 search requests per minute per user — generous enough for normal use but blocks brute-force enumeration.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/users/users.controller.ts
git commit -m "fix: add rate limiting (30/min) to user search endpoint"
```

---

### Task 6: Run full verification

**Covers:** All issues — final sanity check

**Files:** None (verification only)

- [ ] **Step 1: Run all user tests**

Run: `npx jest src/users/ --verbose`
Expected: All PASS.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run full test suite**

Run: `npx jest --verbose`
Expected: All PASS (no regressions).

- [ ] **Step 4: Commit if any fixups needed**

If any tests failed and needed fixing, commit the fixups.

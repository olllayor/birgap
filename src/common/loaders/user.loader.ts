import { Injectable, Scope } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Resolver = {
  resolve: (value: User | null) => void;
  reject: (reason: unknown) => void;
};

@Injectable({ scope: Scope.REQUEST })
export class UserLoader {
  private cache = new Map<string, Promise<User | null>>();
  private batchKeySet = new Set<string>();
  private resolvers = new Map<string, Resolver[]>();
  private dispatchTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  load(id: string): Promise<User | null> {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    this.batchKeySet.add(id);

    const promise = new Promise<User | null>((resolve, reject) => {
      if (!this.resolvers.has(id)) {
        this.resolvers.set(id, []);
      }
      this.resolvers.get(id)!.push({ resolve, reject });
      this.scheduleDispatch();
    });

    this.cache.set(id, promise);
    return promise;
  }

  private scheduleDispatch() {
    if (this.dispatchTimer) return;

    this.dispatchTimer = setTimeout(async () => {
      const ids = [...this.batchKeySet];
      this.batchKeySet.clear();
      this.dispatchTimer = null;

      try {
        const users = await this.prisma.user.findMany({
          where: { id: { in: ids } },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        for (const userId of ids) {
          const user = userMap.get(userId) ?? null;
          const callbacks = this.resolvers.get(userId) || [];
          for (const { resolve } of callbacks) {
            resolve(user);
          }
          this.resolvers.delete(userId);
          this.cache.set(userId, Promise.resolve(user));
        }
      } catch (err) {
        for (const userId of ids) {
          const callbacks = this.resolvers.get(userId) || [];
          for (const { reject } of callbacks) {
            reject(err);
          }
          this.resolvers.delete(userId);
          this.cache.delete(userId);
        }
      }
    }, 0);
  }
}

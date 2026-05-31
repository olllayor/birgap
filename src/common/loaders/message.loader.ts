import { Injectable, Scope } from '@nestjs/common';
import { Message } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Resolver = {
  resolve: (value: Message | null) => void;
  reject: (reason: unknown) => void;
};

@Injectable({ scope: Scope.REQUEST })
export class MessageLoader {
  private cache = new Map<string, Promise<Message | null>>();
  private batchKeySet = new Set<string>();
  private resolvers = new Map<string, Resolver[]>();
  private dispatchTimer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  load(id: string): Promise<Message | null> {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    this.batchKeySet.add(id);

    const promise = new Promise<Message | null>((resolve, reject) => {
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
        const messages = await this.prisma.message.findMany({
          where: { id: { in: ids } },
        });
        const messageMap = new Map(messages.map((m) => [m.id, m]));

        for (const messageId of ids) {
          const message = messageMap.get(messageId) ?? null;
          const callbacks = this.resolvers.get(messageId) || [];
          for (const { resolve } of callbacks) {
            resolve(message);
          }
          this.resolvers.delete(messageId);
          this.cache.set(messageId, Promise.resolve(message));
        }
      } catch (err) {
        for (const messageId of ids) {
          const callbacks = this.resolvers.get(messageId) || [];
          for (const { reject } of callbacks) {
            reject(err);
          }
          this.resolvers.delete(messageId);
          this.cache.delete(messageId);
        }
      }
    }, 0);
  }
}

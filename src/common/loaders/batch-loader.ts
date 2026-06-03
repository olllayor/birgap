type Resolver<T> = {
  resolve: (value: T | null) => void;
  reject: (reason: unknown) => void;
};

/**
 * Per-request batching loader. Schedules one DB fetch per microtask tick to
 * coalesce N concurrent `.load(id)` calls into a single `findMany`. Caches
 * resolved values for the lifetime of the instance (typically one request).
 */
export abstract class BatchLoader<T extends { id: string }> {
  private cache = new Map<string, Promise<T | null>>();
  private batchKeySet = new Set<string>();
  private resolvers = new Map<string, Resolver<T>[]>();
  private dispatchTimer: NodeJS.Timeout | null = null;

  protected abstract fetchBatch(ids: string[]): Promise<T[]>;

  load(id: string): Promise<T | null> {
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }

    this.batchKeySet.add(id);

    const promise = new Promise<T | null>((resolve, reject) => {
      const list = this.resolvers.get(id) ?? [];
      list.push({ resolve, reject });
      this.resolvers.set(id, list);
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
        const rows = await this.fetchBatch(ids);
        const map = new Map(rows.map((r) => [r.id, r]));

        for (const id of ids) {
          const row = map.get(id) ?? null;
          const callbacks = this.resolvers.get(id) ?? [];
          for (const { resolve } of callbacks) {
            resolve(row);
          }
          this.resolvers.delete(id);
          this.cache.set(id, Promise.resolve(row));
        }
      } catch (err) {
        for (const id of ids) {
          const callbacks = this.resolvers.get(id) ?? [];
          for (const { reject } of callbacks) {
            reject(err);
          }
          this.resolvers.delete(id);
          this.cache.delete(id);
        }
      }
    }, 0);
  }
}

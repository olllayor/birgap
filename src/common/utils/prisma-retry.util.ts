import { Prisma } from '@prisma/client';

/**
 * True when `error` is a Prisma unique-constraint violation (P2002) whose target
 * includes the given column. Prisma reports `meta.target` either as an array of
 * column names or as a single constraint-name string depending on the driver, so
 * we handle both shapes.
 */
export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(column);
  }
  if (typeof target === 'string') {
    return target.includes(column);
  }
  return false;
}

/**
 * Runs `fn`, retrying when it fails with a unique-constraint violation on
 * `column`. Used for optimistic per-thread sequence assignment: two concurrent
 * sends can read the same max sequence and collide on the unique index; the
 * loser simply recomputes and retries instead of surfacing a 500 and dropping
 * the message.
 */
export async function retryOnUniqueViolation<T>(
  fn: () => Promise<T>,
  column: string,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolationOn(error, column)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

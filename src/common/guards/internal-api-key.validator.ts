import { timingSafeEqual } from 'crypto';

export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key';

export type InternalApiKeyValidationResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'invalid' };

/**
 * Pure, timing-safe validator for the internal API key contract.
 * Single source of truth shared by `InternalApiKeyGuard` (Nest pipeline)
 * and the Express middleware that protects routes mounted outside Nest
 * (e.g. bull-board's `/queues`).
 */
export function validateInternalApiKey(
  headerValue: unknown,
  expectedKey: string,
): InternalApiKeyValidationResult {
  if (typeof headerValue !== 'string' || headerValue.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  const headerBuf = Buffer.from(headerValue);
  const expectedBuf = Buffer.from(expectedKey);
  if (
    headerBuf.length !== expectedBuf.length ||
    !timingSafeEqual(headerBuf, expectedBuf)
  ) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true };
}

export const INTERNAL_API_KEY_MESSAGES: Record<
  Exclude<InternalApiKeyValidationResult, { ok: true }>['reason'],
  string
> = {
  missing: 'Missing internal API key',
  invalid: 'Invalid internal API key',
};

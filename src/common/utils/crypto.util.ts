import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

export function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url');
}

export function randomDigits(length: number): string {
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return String(randomInt(min, max));
}

export function normalizePhone(phone: string) {
  return phone.trim().replace(/[^\d+]/g, '');
}

export function maskPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (normalized.length <= 6) {
    return '***';
  }
  return `${normalized.slice(0, 6)}****${normalized.slice(-2)}`;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

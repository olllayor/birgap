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
  // Canonicalize to E.164 with a single leading '+'. Telegram delivers contact
  // numbers without the '+' while the app sends them with it — stripping to
  // digits and re-prefixing guarantees both sides hash to the same value.
  const digits = phone.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

export function maskPhone(phone: string) {
  return normalizePhone(phone);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

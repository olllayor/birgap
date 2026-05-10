// Shared TypeScript types for BirGap API
// Mirror the backend DTOs and domain models

// ── Auth ──────────────────────────────────────────────
export interface OtpRequestDto {
  phone: string;
}

export interface OtpVerifyDto {
  phone: string;
  code: string;
}

export interface TokenPair {
  user: { id: string };
  accessToken: string;
  refreshToken: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}

export interface LogoutDto {
  refreshToken?: string;
}

// ── Devices ───────────────────────────────────────────
export interface DeviceInfo {
  id: string;
  userId: string;
  platform: 'ANDROID' | 'IOS' | 'WEB';
  displayName?: string;
  identityPublicKey: string;
  pushToken?: string;
  pushPlatform?: 'FCM' | 'APNS' | 'HMS';
  pushActive: boolean;
  active: boolean;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterDeviceDto {
  deviceId?: string;
  platform: string;
  displayName?: string;
  identityPublicKey: string;
  pushToken?: string;
  pushPlatform?: string;
  pushActive: boolean;
}

// ── Messages ──────────────────────────────────────────
export interface SendMessageDto {
  senderDeviceId: string;
  recipientUserId: string;
  idempotencyKey: string;
  envelopes: MessageEnvelopeDto[];
}

export interface MessageEnvelopeDto {
  recipientDeviceId: string;
  ciphertext: object; // opaque encrypted JSON
}

export interface MessageEnvelope {
  id: string;
  messageId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  ciphertext: object;
  status: 'PENDING' | 'DELIVERED' | 'READ';
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  threadId: string;
  senderUserId: string;
  senderDeviceId: string;
  idempotencyKey: string;
  threadSequence: number;
  createdAt: string;
  envelopes: MessageEnvelope[];
}

export interface PendingMessagesResponse {
  deviceId: string;
  envelopes: Array<MessageEnvelope & { message: Pick<Message, 'id' | 'threadId' | 'senderUserId' | 'senderDeviceId' | 'threadSequence' | 'createdAt'> }>;
}

export interface AckMessageDto {
  deviceId: string;
  status: 'DELIVERED' | 'READ';
}

// ── Prekeys ───────────────────────────────────────────
export interface PrekeyDto {
  keyId: number;
  publicKey: string;
}

export interface SignedPrekeyDto {
  keyId: number;
  publicKey: string;
  signature: string;
}

export interface PrekeyBundle {
  deviceId: string;
  userId: string;
  platform: string;
  identityPublicKey: string;
  signedPrekey?: {
    id: string;
    keyId: number;
    publicKey: string;
    signature: string;
    createdAt: string;
  } | null;
  oneTimePrekey?: {
    keyId: number;
    publicKey: string;
  } | null;
}

export interface KeyBundlesResponse {
  userId: string;
  devices: PrekeyBundle[];
}

export interface RefillPrekeysDto {
  prekeys: PrekeyDto[];
}

export interface RotateSignedPrekeyDto {
  keyId: number;
  publicKey: string;
  signature: string;
}

// ── Realtime ──────────────────────────────────────────
export interface SocketTicketResponse {
  ticket: string;
  expiresAt: string;
}

export interface TypingDto {
  recipientUserId: string;
}

// ── Backups ───────────────────────────────────────────
export interface BackupBlob {
  id: string;
  userId: string;
  version: number;
  blob: string;
  checksum: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface PutBackupDto {
  version: number;
  blob: string;
  checksum: string;
}

export interface BackupMetadata {
  id: string;
  userId: string;
  version: number;
  checksum: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

// ── Health ────────────────────────────────────────────
export interface HealthResponse {
  status: string;
  timestamp: string;
}

// ── Session State (internal) ─────────────────────────
export interface AuthState {
  user: { id: string };
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: number; // unix ms
}
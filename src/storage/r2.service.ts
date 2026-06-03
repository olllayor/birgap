import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

export const ALLOWED_MEDIA_MIME: Record<'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT', string[]> = {
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  VIDEO: ['video/mp4', 'video/quicktime'],
  AUDIO: ['audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/mp4'],
  DOCUMENT: ['application/pdf', 'text/plain'],
};

const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@Injectable()
export class R2Service implements OnModuleInit {
  private readonly logger = new Logger(R2Service.name);
  private client!: S3Client;
  private bucket!: string;
  private putTtl!: number;
  private getTtl!: number;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.client = new S3Client({
      region: 'auto',
      endpoint: this.config.get<string>('R2_ENDPOINT')!,
      credentials: {
        accessKeyId: this.config.get<string>('R2_ACCESS_KEY_ID')!,
        secretAccessKey: this.config.get<string>('R2_SECRET_ACCESS_KEY')!,
      },
    });
    this.bucket = this.config.get<string>('R2_BUCKET_NAME') ?? 'birgap-backups';
    this.putTtl = this.config.get<number>('R2_PRESIGNED_PUT_TTL_SECONDS') ?? 900;
    this.getTtl = this.config.get<number>('R2_PRESIGNED_GET_TTL_SECONDS') ?? 300;
  }

  async generateUploadUrl(userId: string, sizeBytes: number): Promise<{ uploadUrl: string; bucketKey: string }> {
    const bucketKey = `backups/${userId}/${randomUUID()}.bin`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: bucketKey,
      ContentLength: sizeBytes,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.putTtl });

    return { uploadUrl, bucketKey };
  }

  async generatePresignedUploadUrl(
    userId: string,
    filename: string,
    mimeType: string,
    sizeBytes: number,
    purpose: 'avatar' | 'media',
    mediaType?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT',
  ): Promise<{ uploadUrl: string; bucketKey: string }> {
    const maxAvatarSize = 5 * 1024 * 1024; // 5MB
    const maxMediaSize = 100 * 1024 * 1024; // 100MB

    if (purpose === 'avatar' && sizeBytes > maxAvatarSize) {
      throw new BadRequestException(`Avatar size exceeds limit of 5MB: got ${sizeBytes} bytes`);
    }
    if (purpose === 'media' && sizeBytes > maxMediaSize) {
      throw new BadRequestException(`Media size exceeds limit of 100MB: got ${sizeBytes} bytes`);
    }

    if (purpose === 'avatar' && !ALLOWED_AVATAR_MIME.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid avatar mime type: ${mimeType}. Only jpeg, png, webp, and gif are allowed.`,
      );
    }

    if (purpose === 'media') {
      if (!mediaType) {
        throw new BadRequestException('mediaType is required for media uploads');
      }
      const allowed = ALLOWED_MEDIA_MIME[mediaType];
      if (!allowed) {
        throw new BadRequestException(`Invalid mediaType: ${mediaType}`);
      }
      if (!allowed.includes(mimeType)) {
        throw new BadRequestException(
          `Invalid mime type for ${mediaType}: ${mimeType}. Allowed: ${allowed.join(', ')}`,
        );
      }
    }

    const uuid = randomUUID();
    const extension = filename.split('.').pop() ?? 'bin';
    const cleanExtension = extension.replace(/[^a-zA-Z0-9]/g, '');
    const folder = purpose === 'avatar' ? 'avatars' : 'media';
    const bucketKey = `${folder}/${userId}/${uuid}.${cleanExtension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: bucketKey,
      ContentLength: sizeBytes,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: this.putTtl });

    return { uploadUrl, bucketKey };
  }

  async generateDownloadUrl(bucketKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: bucketKey,
    });

    return getSignedUrl(this.client, command, { expiresIn: this.getTtl });
  }

  async verifyObjectExists(bucketKey: string, expectedSize: number): Promise<void> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: bucketKey,
    });

    const head = await this.client.send(command);
    if (head.ContentLength !== expectedSize) {
      throw new Error(
        `Size mismatch: expected ${expectedSize}, got ${head.ContentLength}`,
      );
    }
  }

  async deleteObject(bucketKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: bucketKey,
    });

    await this.client.send(command);
  }
}

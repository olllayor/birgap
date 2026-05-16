import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

@Injectable()
export class R2Service implements OnModuleInit {
  private readonly logger = new Logger(R2Service.name);
  private client: S3Client;
  private bucket: string;
  private putTtl: number;
  private getTtl: number;

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

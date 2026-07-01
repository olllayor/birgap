import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { PutBackupDto } from './dto/put-backup.dto';
import { UploadUrlDto } from './dto/upload-url.dto';
import { StorageCleanupJobData } from './queue/storage-cleanup-job.interface';

@Injectable()
export class BackupsService {
  private readonly logger = new Logger(BackupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    @InjectQueue('storage-cleanup')
    private readonly cleanupQueue: Queue<StorageCleanupJobData>,
  ) {}

  async getUploadUrl(userId: string, dto: UploadUrlDto) {
    const { uploadUrl, bucketKey } = await this.r2.generateUploadUrl(userId, dto.sizeBytes);
    return { uploadUrl, bucketKey, method: 'PUT' as const };
  }

  async putCurrent(userId: string, dto: PutBackupDto) {
    const existing = await this.prisma.backupBlob.findUnique({
      where: { userId },
      select: { bucketKey: true },
    });

    await this.r2.verifyObjectExists(dto.bucketKey, dto.sizeBytes);

    const backup = await this.prisma.backupBlob.upsert({
      where: { userId },
      update: {
        bucketKey: dto.bucketKey,
        sha256: dto.sha256,
        sizeBytes: dto.sizeBytes,
        version: dto.version,
      },
      create: {
        userId,
        bucketKey: dto.bucketKey,
        sha256: dto.sha256,
        sizeBytes: dto.sizeBytes,
        version: dto.version,
      },
      select: {
        id: true,
        version: true,
        sha256: true,
        sizeBytes: true,
        uploadedAt: true,
      },
    });

    if (existing && existing.bucketKey !== dto.bucketKey) {
      await this.cleanupQueue.add('delete-old-backup', {
        bucketKey: existing.bucketKey,
      });
    }

    return backup;
  }

  async getCurrent(userId: string) {
    const backup = await this.prisma.backupBlob.findUnique({ where: { userId } });
    if (!backup) {
      throw new NotFoundException('Backup not found');
    }

    const downloadUrl = await this.r2.generateDownloadUrl(backup.bucketKey);

    return {
      downloadUrl,
      sha256: backup.sha256,
      sizeBytes: backup.sizeBytes,
      version: backup.version,
      uploadedAt: backup.uploadedAt,
    };
  }

  async getMetadata(userId: string) {
    const backup = await this.prisma.backupBlob.findUnique({
      where: { userId },
      select: {
        sha256: true,
        sizeBytes: true,
        version: true,
        uploadedAt: true,
      },
    });
    if (!backup) {
      throw new NotFoundException('Backup not found');
    }
    return backup;
  }
}

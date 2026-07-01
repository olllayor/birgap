import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { MessageMedia, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { InitMediaDto } from './dto/init-media.dto';
import { CompleteMediaDto } from './dto/complete-media.dto';
import { StorageCleanupJobData } from '../backups/queue/storage-cleanup-job.interface';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly maxAttachments: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly config: ConfigService,
    @InjectQueue('storage-cleanup') private readonly storageCleanupQueue: Queue,
  ) {
    this.maxAttachments = this.config.get<number>('MEDIA_MAX_ATTACHMENTS_PER_MESSAGE') ?? 10;
  }

  async initUpload(userId: string, dto: InitMediaDto) {
    const { uploadUrl, bucketKey } = await this.r2.generatePresignedUploadUrl(
      userId,
      dto.filename,
      dto.mimeType,
      dto.sizeBytes,
      'media',
      dto.mediaType,
    );

    const media = await this.prisma.messageMedia.create({
      data: {
        userId,
        messageId: null,
        mediaType: dto.mediaType,
        bucketKey,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        filename: dto.filename,
        mediaCiphertextHash: dto.mediaCiphertextHash,
        thumbnailCiphertextHash: dto.thumbnailCiphertextHash,
        width: dto.width,
        height: dto.height,
        duration: dto.duration,
        uploadStatus: 'PENDING',
      },
      select: { id: true, bucketKey: true },
    });

    return {
      mediaId: media.id,
      uploadUrl,
      bucketKey: media.bucketKey,
    };
  }

  async completeUpload(userId: string, mediaId: string, dto: CompleteMediaDto) {
    const media = await this.prisma.messageMedia.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        userId: true,
        bucketKey: true,
        mediaType: true,
        mimeType: true,
        sizeBytes: true,
        uploadStatus: true,
      },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (media.userId !== userId) {
      throw new ForbiddenException('Not the owner of this media');
    }
    if (media.uploadStatus !== 'PENDING') {
      throw new BadRequestException(`Media is already ${media.uploadStatus.toLowerCase()}`);
    }

    await this.r2.verifyObjectExists(media.bucketKey, dto.sizeBytes);

    const updated = await this.prisma.messageMedia.update({
      where: { id: mediaId },
      data: {
        uploadStatus: 'COMPLETE',
        uploadedAt: new Date(),
        sizeBytes: dto.sizeBytes,
      },
      select: {
        id: true,
        bucketKey: true,
        mediaType: true,
        mimeType: true,
        sizeBytes: true,
      },
    });

    return updated;
  }

  async getDownloadUrl(userId: string, mediaId: string) {
    const media = await this.prisma.messageMedia.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        bucketKey: true,
        uploadStatus: true,
        messageId: true,
        userId: true,
      },
    });

    if (!media) {
      throw new NotFoundException('Media not found');
    }

    if (!media.messageId) {
      throw new BadRequestException('Media has not been attached to a message yet');
    }

    if (media.uploadStatus !== 'COMPLETE') {
      throw new ForbiddenException('Media upload is not complete');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: media.messageId },
      select: {
        id: true,
        threadId: true,
        groupId: true,
        deletedAt: true,
        thread: { select: { userAId: true, userBId: true } },
      },
    });

    if (!message) {
      throw new NotFoundException('Parent message not found');
    }
    if (message.deletedAt) {
      throw new ForbiddenException('Message has been deleted');
    }

    if (message.threadId) {
      const isParticipant =
        message.thread?.userAId === userId || message.thread?.userBId === userId;
      if (!isParticipant) {
        throw new ForbiddenException('Not a participant in this thread');
      }
    } else if (message.groupId) {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: message.groupId, userId } },
        select: { groupId: true },
      });
      if (!member) {
        throw new ForbiddenException('Not a member of this group');
      }
    }

    const downloadUrl = await this.r2.generateDownloadUrl(media.bucketKey);
    return { downloadUrl, expiresIn: this.config.get<number>('R2_PRESIGNED_GET_TTL_SECONDS') ?? 300 };
  }

  async assertAttachmentsOwned(
    userId: string,
    mediaIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<MessageMedia[]> {
    if (mediaIds.length === 0) return [];
    if (mediaIds.length > this.maxAttachments) {
      throw new BadRequestException(
        `Too many attachments: ${mediaIds.length} > max ${this.maxAttachments}`,
      );
    }

    const uniqueIds = Array.from(new Set(mediaIds));
    if (uniqueIds.length !== mediaIds.length) {
      throw new BadRequestException('Duplicate mediaIds in request');
    }

    const client = tx ?? this.prisma;
    const rows = await client.messageMedia.findMany({
      where: { id: { in: uniqueIds } },
    });

    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException('One or more mediaIds do not exist');
    }

    for (const row of rows) {
      if (row.userId !== userId) {
        throw new ForbiddenException('Not the owner of one or more attachments');
      }
      if (row.messageId !== null) {
        throw new BadRequestException('One or more attachments are already attached to a message');
      }
      if (row.uploadStatus !== 'COMPLETE') {
        throw new BadRequestException(
          `One or more attachments are not fully uploaded (status: ${row.uploadStatus})`,
        );
      }
    }

    return rows;
  }

  async cloneMediaForForward(
    tx: Prisma.TransactionClient,
    forwarderUserId: string,
    newMessageId: string,
    sourceMedia: MessageMedia[],
  ): Promise<void> {
    if (sourceMedia.length === 0) return;

    await tx.messageMedia.createMany({
      data: sourceMedia.map((m) => ({
        userId: forwarderUserId,
        messageId: newMessageId,
        mediaType: m.mediaType,
        bucketKey: m.bucketKey,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        filename: m.filename,
        thumbnailBucketKey: m.thumbnailBucketKey,
        width: m.width,
        height: m.height,
        duration: m.duration,
        mediaCiphertextHash: m.mediaCiphertextHash,
        thumbnailCiphertextHash: m.thumbnailCiphertextHash,
        uploadStatus: 'COMPLETE' as const,
        uploadedAt: new Date(),
      })),
    });
  }

  async cleanupMessageMedia(messageId: string): Promise<void> {
    const media = await this.prisma.messageMedia.findMany({
      where: { messageId },
      select: { id: true, bucketKey: true, thumbnailBucketKey: true },
    });

    for (const m of media) {
      const otherRefs = await this.prisma.messageMedia.count({
        where: { bucketKey: m.bucketKey, messageId: { not: messageId } },
      });
      if (otherRefs === 0) {
        const jobData: StorageCleanupJobData = { bucketKey: m.bucketKey };
        await this.storageCleanupQueue.add('cleanup', jobData).catch((error) => {
          this.logger.error(
            `Failed to enqueue storage-cleanup for ${m.bucketKey}: ${(error as Error).message}`,
          );
        });
      }

      if (m.thumbnailBucketKey) {
        const thumbRefs = await this.prisma.messageMedia.count({
          where: { bucketKey: m.thumbnailBucketKey, messageId: { not: messageId } },
        });
        if (thumbRefs === 0) {
          await this.storageCleanupQueue
            .add('cleanup', { bucketKey: m.thumbnailBucketKey } satisfies StorageCleanupJobData)
            .catch((error) => {
              this.logger.error(
                `Failed to enqueue storage-cleanup for ${m.thumbnailBucketKey}: ${(error as Error).message}`,
              );
            });
        }
      }
    }
  }
}

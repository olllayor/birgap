import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../storage/r2.service';
import { MediaService } from './media.service';

const mockConfig = {
  get: jest.fn().mockImplementation((key: string, defaultValue: unknown) => {
    if (key === 'MEDIA_MAX_ATTACHMENTS_PER_MESSAGE') return 10;
    if (key === 'R2_PRESIGNED_GET_TTL_SECONDS') return 300;
    return defaultValue;
  }),
} as unknown as ConfigService;

const mockStorageCleanupQueue = {
  add: jest.fn().mockResolvedValue(undefined),
} as unknown as Queue;

describe('MediaService', () => {
  describe('initUpload', () => {
    it('rejects mime that does not match the allowlist for the declared mediaType', async () => {
      const r2 = {
        generatePresignedUploadUrl: jest
          .fn()
          .mockRejectedValue(new Error('Invalid mime type for IMAGE: image/bmp')),
      } as unknown as R2Service;
      const prisma = {} as PrismaService;
      const service = new MediaService(prisma, r2, mockConfig, mockStorageCleanupQueue);

      await expect(
        service.initUpload('user-1', {
          mediaType: 'IMAGE',
          filename: 'photo.bmp',
          mimeType: 'image/bmp',
          sizeBytes: 1024,
          mediaCiphertextHash: 'hash',
        }),
      ).rejects.toThrow('Invalid mime type for IMAGE');
    });

    it('creates a PENDING row and returns the presigned URL', async () => {
      const r2 = {
        generatePresignedUploadUrl: jest.fn().mockResolvedValue({
          uploadUrl: 'https://r2.example.com/presigned',
          bucketKey: 'media/user-1/abc.jpg',
        }),
      } as unknown as R2Service;
      const create = jest.fn().mockResolvedValue({ id: 'media-1', bucketKey: 'media/user-1/abc.jpg' });
      const prisma = { messageMedia: { create } } as unknown as PrismaService;
      const service = new MediaService(prisma, r2, mockConfig, mockStorageCleanupQueue);

      const result = await service.initUpload('user-1', {
        mediaType: 'IMAGE',
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
        mediaCiphertextHash: 'hash',
      });

      expect(result).toEqual({
        mediaId: 'media-1',
        uploadUrl: 'https://r2.example.com/presigned',
        bucketKey: 'media/user-1/abc.jpg',
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            messageId: null,
            mediaType: 'IMAGE',
            uploadStatus: 'PENDING',
          }),
        }),
      );
    });
  });

  describe('completeUpload', () => {
    it('rejects when ownership does not match', async () => {
      const r2 = {} as R2Service;
      const prisma = {
        messageMedia: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'media-1',
            userId: 'other-user',
            bucketKey: 'media/other-user/abc.jpg',
            uploadStatus: 'PENDING',
          }),
        },
      } as unknown as PrismaService;
      const service = new MediaService(prisma, r2, mockConfig, mockStorageCleanupQueue);

      await expect(
        service.completeUpload('user-1', 'media-1', { sizeBytes: 1024 }),
      ).rejects.toThrow('Not the owner of this media');
    });

    it('verifies the upload and flips the row to COMPLETE', async () => {
      const verify = jest.fn().mockResolvedValue(undefined);
      const update = jest.fn().mockResolvedValue({
        id: 'media-1',
        bucketKey: 'media/user-1/abc.jpg',
        mediaType: 'IMAGE',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      });
      const r2 = { verifyObjectExists: verify } as unknown as R2Service;
      const prisma = {
        messageMedia: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'media-1',
            userId: 'user-1',
            bucketKey: 'media/user-1/abc.jpg',
            uploadStatus: 'PENDING',
          }),
          update,
        },
      } as unknown as PrismaService;
      const service = new MediaService(prisma, r2, mockConfig, mockStorageCleanupQueue);

      const result = await service.completeUpload('user-1', 'media-1', { sizeBytes: 1024 });

      expect(verify).toHaveBeenCalledWith('media/user-1/abc.jpg', 1024);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ uploadStatus: 'COMPLETE' }),
        }),
      );
      expect(result.id).toBe('media-1');
    });
  });

  describe('assertAttachmentsOwned', () => {
    const makeService = (rows: unknown[]) => {
      const findMany = jest.fn().mockResolvedValue(rows);
      const prisma = { messageMedia: { findMany } } as unknown as PrismaService;
      const r2 = {} as R2Service;
      return { service: new MediaService(prisma, r2, mockConfig, mockStorageCleanupQueue), findMany };
    };

    it('returns [] for empty input', async () => {
      const { service } = makeService([]);
      const result = await service.assertAttachmentsOwned('user-1', []);
      expect(result).toEqual([]);
    });

    it('rejects media owned by a different user', async () => {
      const { service } = makeService([
        { id: 'media-1', userId: 'other-user', messageId: null, uploadStatus: 'COMPLETE' },
      ]);
      await expect(service.assertAttachmentsOwned('user-1', ['media-1'])).rejects.toThrow(
        'Not the owner of one or more attachments',
      );
    });

    it('rejects media already attached to a message', async () => {
      const { service } = makeService([
        { id: 'media-1', userId: 'user-1', messageId: 'message-1', uploadStatus: 'COMPLETE' },
      ]);
      await expect(service.assertAttachmentsOwned('user-1', ['media-1'])).rejects.toThrow(
        'already attached to a message',
      );
    });

    it('rejects media not yet in COMPLETE status', async () => {
      const { service } = makeService([
        { id: 'media-1', userId: 'user-1', messageId: null, uploadStatus: 'PENDING' },
      ]);
      await expect(service.assertAttachmentsOwned('user-1', ['media-1'])).rejects.toThrow(
        'not fully uploaded',
      );
    });

    it('rejects duplicate mediaIds', async () => {
      const { service } = makeService([]);
      await expect(service.assertAttachmentsOwned('user-1', ['media-1', 'media-1'])).rejects.toThrow(
        'Duplicate mediaIds',
      );
    });

    it('rejects when count exceeds max attachments', async () => {
      const { service } = makeService([]);
      await expect(
        service.assertAttachmentsOwned('user-1', Array(11).fill('media-x')),
      ).rejects.toThrow('Too many attachments');
    });
  });

  describe('cleanupMessageMedia', () => {
    it('enqueues one storage-cleanup job per bucket key (incl. thumbnail)', async () => {
      const add = jest.fn().mockResolvedValue(undefined);
      const queue = { add } as unknown as Queue;
      const prisma = {
        messageMedia: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { id: 'media-1', bucketKey: 'media/user-1/a.jpg', thumbnailBucketKey: 'media/user-1/a-thumb.jpg' },
              { id: 'media-2', bucketKey: 'media/user-1/b.jpg', thumbnailBucketKey: null },
            ]),
          count: jest.fn().mockResolvedValue(0),
        },
      } as unknown as PrismaService;
      const r2 = {} as R2Service;
      const service = new MediaService(prisma, r2, mockConfig, queue);

      await service.cleanupMessageMedia('message-1');

      expect(add).toHaveBeenCalledTimes(3);
      expect(add).toHaveBeenCalledWith('cleanup', { bucketKey: 'media/user-1/a.jpg' });
      expect(add).toHaveBeenCalledWith('cleanup', { bucketKey: 'media/user-1/a-thumb.jpg' });
      expect(add).toHaveBeenCalledWith('cleanup', { bucketKey: 'media/user-1/b.jpg' });
    });

    it('skips R2 deletion when another message shares the same bucketKey', async () => {
      const add = jest.fn().mockResolvedValue(undefined);
      const queue = { add } as unknown as Queue;
      const prisma = {
        messageMedia: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'media-1', bucketKey: 'media/user-1/shared.jpg', thumbnailBucketKey: null },
          ]),
          count: jest.fn().mockResolvedValue(1),
        },
      } as unknown as PrismaService;
      const r2 = {} as R2Service;
      const service = new MediaService(prisma, r2, mockConfig, queue);

      await service.cleanupMessageMedia('message-1');

      expect(add).not.toHaveBeenCalled();
    });

    it('skips thumbnail R2 deletion when another message references the same thumbnail key', async () => {
      const add = jest.fn().mockResolvedValue(undefined);
      const queue = { add } as unknown as Queue;
      const prisma = {
        messageMedia: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'media-1', bucketKey: 'media/user-1/a.jpg', thumbnailBucketKey: 'media/user-1/shared-thumb.jpg' },
          ]),
          count: jest.fn()
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(2),
        },
      } as unknown as PrismaService;
      const r2 = {} as R2Service;
      const service = new MediaService(prisma, r2, mockConfig, queue);

      await service.cleanupMessageMedia('message-1');

      expect(add).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledWith('cleanup', { bucketKey: 'media/user-1/a.jpg' });
    });
  });
});

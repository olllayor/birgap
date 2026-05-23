import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { R2Service } from './r2.service';

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => {
      return {
        send: jest.fn(),
      };
    }),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    HeadObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => {
  return {
    getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com/upload'),
  };
});

describe('R2Service', () => {
  let service: R2Service;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        R2Service,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'R2_ENDPOINT') return 'https://mock-endpoint.com';
              if (key === 'R2_ACCESS_KEY_ID') return 'mock-key';
              if (key === 'R2_SECRET_ACCESS_KEY') return 'mock-secret';
              if (key === 'R2_BUCKET_NAME') return 'mock-bucket';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<R2Service>(R2Service);
    service.onModuleInit();
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generatePresignedUploadUrl', () => {
    it('should generate a valid presigned upload URL for avatars under 5MB with safe mime types', async () => {
      const result = await service.generatePresignedUploadUrl(
        'user-123',
        'avatar.png',
        'image/png',
        1024 * 1024 * 2, // 2MB
        'avatar',
      );

      expect(result.uploadUrl).toBe('https://mock-presigned-url.com/upload');
      expect(result.bucketKey).toContain('avatars/user-123/');
      expect(result.bucketKey).toMatch(/\.png$/);
    });

    it('should throw an error for avatars exceeding 5MB limit', async () => {
      await expect(
        service.generatePresignedUploadUrl(
          'user-123',
          'huge-avatar.png',
          'image/png',
          1024 * 1024 * 6, // 6MB
          'avatar',
        ),
      ).rejects.toThrow('Avatar size exceeds limit of 5MB');
    });

    it('should throw an error for invalid avatar mime types', async () => {
      await expect(
        service.generatePresignedUploadUrl(
          'user-123',
          'avatar.pdf',
          'application/pdf',
          1024 * 1024,
          'avatar',
        ),
      ).rejects.toThrow('Invalid avatar mime type');
    });

    it('should generate a valid presigned upload URL for media under 100MB', async () => {
      const result = await service.generatePresignedUploadUrl(
        'user-123',
        'video.mp4',
        'video/mp4',
        1024 * 1024 * 50, // 50MB
        'media',
      );

      expect(result.uploadUrl).toBe('https://mock-presigned-url.com/upload');
      expect(result.bucketKey).toContain('media/user-123/');
      expect(result.bucketKey).toMatch(/\.mp4$/);
    });

    it('should throw an error for media exceeding 100MB limit', async () => {
      await expect(
        service.generatePresignedUploadUrl(
          'user-123',
          'huge-video.mp4',
          'video/mp4',
          1024 * 1024 * 105, // 105MB
          'media',
        ),
      ).rejects.toThrow('Media size exceeds limit of 100MB');
    });
  });
});

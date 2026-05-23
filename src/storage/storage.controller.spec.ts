import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StorageController } from './storage.controller';
import { R2Service } from './r2.service';
import { PresignedUploadDto } from './dto/presigned-upload.dto';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';

describe('StorageController', () => {
  let controller: StorageController;
  let r2Service: R2Service;

  const mockR2Service = {
    generatePresignedUploadUrl: jest.fn(),
  };

  const mockUser: AuthenticatedUser = {
    userId: 'user-789',
    sessionId: 'session-456',
  };

  beforeEach(async () => {
    mockR2Service.generatePresignedUploadUrl.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [
        {
          provide: R2Service,
          useValue: mockR2Service,
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<StorageController>(StorageController);
    r2Service = module.get<R2Service>(R2Service);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPresignedUploadUrl', () => {
    it('should successfully delegate the presigned URL generation to r2Service', async () => {
      const dto: PresignedUploadDto = {
        filename: 'test.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        purpose: 'avatar',
      };

      const mockResponse = {
        uploadUrl: 'https://presigned.s3.endpoint/upload-path',
        bucketKey: 'avatars/user-789/uuid-here.jpg',
      };

      mockR2Service.generatePresignedUploadUrl.mockResolvedValue(mockResponse);

      const result = await controller.getPresignedUploadUrl(mockUser, dto);

      expect(r2Service.generatePresignedUploadUrl).toHaveBeenCalledWith(
        mockUser.userId,
        dto.filename,
        dto.mimeType,
        dto.sizeBytes,
        dto.purpose,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should throw BadRequestException if r2Service throws an error', async () => {
      const dto: PresignedUploadDto = {
        filename: 'test.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 100,
        purpose: 'avatar',
      };

      mockR2Service.generatePresignedUploadUrl.mockRejectedValue(new Error('Invalid avatar mime type'));

      await expect(
        controller.getPresignedUploadUrl(mockUser, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

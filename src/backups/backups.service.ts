import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PutBackupDto } from './dto/put-backup.dto';

@Injectable()
export class BackupsService {
  constructor(private readonly prisma: PrismaService) {}

  async putCurrent(userId: string, dto: PutBackupDto) {
    const sizeBytes = Buffer.byteLength(dto.blob, 'utf8');
    const backup = await this.prisma.backupBlob.upsert({
      where: { userId },
      update: {
        version: dto.version,
        blob: dto.blob,
        checksum: dto.checksum,
        sizeBytes,
      },
      create: {
        userId,
        version: dto.version,
        blob: dto.blob,
        checksum: dto.checksum,
        sizeBytes,
      },
      select: {
        id: true,
        version: true,
        checksum: true,
        sizeBytes: true,
        updatedAt: true,
      },
    });

    return backup;
  }

  async getCurrent(userId: string) {
    const backup = await this.prisma.backupBlob.findUnique({ where: { userId } });
    if (!backup) {
      throw new NotFoundException('Backup not found');
    }
    return backup;
  }

  async getMetadata(userId: string) {
    const backup = await this.prisma.backupBlob.findUnique({
      where: { userId },
      select: {
        id: true,
        version: true,
        checksum: true,
        sizeBytes: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!backup) {
      throw new NotFoundException('Backup not found');
    }
    return backup;
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFolderDto, FolderThreadDto, UpdateFolderDto } from './dto/folders.dto';

const MAX_FOLDERS_PER_USER = 20;

// Telegram-style chat folders: pure organisational metadata over existing
// direct threads and groups. Names are plaintext (no message content), the
// thread mapping is polymorphic (same pattern as UnreadCounter).
@Injectable()
export class FoldersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const folders = await this.prisma.folder.findMany({
      where: { userId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: { threads: { orderBy: { createdAt: 'asc' } } },
    });
    return {
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        emoji: f.emoji,
        position: f.position,
        threads: f.threads.map((t) => ({ threadType: t.threadType, threadId: t.threadId })),
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
    };
  }

  async create(userId: string, dto: CreateFolderDto) {
    const count = await this.prisma.folder.count({ where: { userId } });
    if (count >= MAX_FOLDERS_PER_USER) {
      throw new BadRequestException(`Folder limit reached (${MAX_FOLDERS_PER_USER})`);
    }
    try {
      return await this.prisma.folder.create({
        data: {
          userId,
          name: dto.name.trim(),
          emoji: dto.emoji ?? null,
          position: dto.position ?? count,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('A folder with this name already exists');
      }
      throw error;
    }
  }

  async update(userId: string, folderId: string, dto: UpdateFolderDto) {
    await this.assertOwned(userId, folderId);
    try {
      return await this.prisma.folder.update({
        where: { id: folderId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.emoji !== undefined && { emoji: dto.emoji }),
          ...(dto.position !== undefined && { position: dto.position }),
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new BadRequestException('A folder with this name already exists');
      }
      throw error;
    }
  }

  async remove(userId: string, folderId: string) {
    await this.assertOwned(userId, folderId);
    await this.prisma.folder.delete({ where: { id: folderId } });
    return { success: true };
  }

  async addThread(userId: string, folderId: string, dto: FolderThreadDto) {
    await this.assertOwned(userId, folderId);
    await this.assertThreadAccess(userId, dto.threadType, dto.threadId);

    // Idempotent: re-adding an already-mapped thread returns the existing row.
    await this.prisma.folderThread.upsert({
      where: {
        folderId_threadType_threadId: {
          folderId,
          threadType: dto.threadType,
          threadId: dto.threadId,
        },
      },
      create: { folderId, threadType: dto.threadType, threadId: dto.threadId },
      update: {},
    });
    return { success: true, folderId, threadType: dto.threadType, threadId: dto.threadId };
  }

  async removeThread(userId: string, folderId: string, threadType: string, threadId: string) {
    await this.assertOwned(userId, folderId);
    const deleted = await this.prisma.folderThread.deleteMany({
      where: { folderId, threadType, threadId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Thread is not in this folder');
    }
    return { success: true };
  }

  private async assertOwned(userId: string, folderId: string) {
    const folder = await this.prisma.folder.findUnique({
      where: { id: folderId },
      select: { userId: true },
    });
    if (!folder) {
      throw new NotFoundException('Folder not found');
    }
    if (folder.userId !== userId) {
      throw new ForbiddenException('Not your folder');
    }
  }

  private async assertThreadAccess(userId: string, threadType: 'direct' | 'group', threadId: string) {
    if (threadType === 'direct') {
      const thread = await this.prisma.directThread.findUnique({
        where: { id: threadId },
        select: { userAId: true, userBId: true },
      });
      if (!thread) {
        throw new NotFoundException('Thread not found');
      }
      if (thread.userAId !== userId && thread.userBId !== userId) {
        throw new ForbiddenException('Not a participant in this thread');
      }
    } else {
      const member = await this.prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: threadId, userId } },
      });
      if (!member) {
        throw new ForbiddenException('Not a member of this group');
      }
    }
  }
}

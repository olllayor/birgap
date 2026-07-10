import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ContactEntryDto } from './dto/contacts.dto';

const REGISTERED_USER_SELECT = {
  id: true,
  username: true,
  profileAvatarUrl: true,
  encryptedProfile: true,
  profileKeyHash: true,
} as const;

// Persistent server-side contact book. Discovery works like Telegram: the
// client uploads salted phone hashes, the server links each row to a
// registered user when that hash matches (re-checked on every sync, so
// contacts who join later get resolved without client action).
@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertContacts(ownerId: string, entries: ContactEntryDto[]) {
    // Dedupe by phoneHash within the batch — last entry wins.
    const byHash = new Map(entries.map((e) => [e.phoneHash, e]));
    const hashes = Array.from(byHash.keys());

    const registered = await this.prisma.user.findMany({
      where: { phoneHash: { in: hashes }, status: 'ACTIVE', id: { not: ownerId } },
      select: { id: true, phoneHash: true },
    });
    const userByHash = new Map(registered.map((u) => [u.phoneHash, u.id]));

    await this.prisma.$transaction(
      Array.from(byHash.values()).map((entry) =>
        this.prisma.contact.upsert({
          where: { ownerId_phoneHash: { ownerId, phoneHash: entry.phoneHash } },
          create: {
            ownerId,
            phoneHash: entry.phoneHash,
            contactUserId: userByHash.get(entry.phoneHash) ?? null,
            encryptedLabel: (entry.encryptedLabel ?? undefined) as Prisma.InputJsonValue | undefined,
          },
          update: {
            contactUserId: userByHash.get(entry.phoneHash) ?? null,
            ...(entry.encryptedLabel !== undefined && {
              encryptedLabel: entry.encryptedLabel as Prisma.InputJsonValue,
            }),
          },
        }),
      ),
    );

    return this.list(ownerId);
  }

  async list(ownerId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'asc' },
      include: { contactUser: { select: REGISTERED_USER_SELECT } },
    });
    return {
      contacts: contacts.map((c) => ({
        id: c.id,
        phoneHash: c.phoneHash,
        encryptedLabel: c.encryptedLabel,
        user: c.contactUser,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  async remove(ownerId: string, contactId: string) {
    const deleted = await this.prisma.contact.deleteMany({
      where: { id: contactId, ownerId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Contact not found');
    }
    return { success: true };
  }

  /**
   * Full address-book sync: upserts every uploaded hash, re-resolves
   * registration links, and prunes rows whose hash is no longer on the device.
   * Returns the resulting contact list (registered users resolved).
   */
  async sync(ownerId: string, phoneHashes: string[]) {
    const unique = Array.from(new Set(phoneHashes));

    const registered = unique.length
      ? await this.prisma.user.findMany({
          where: { phoneHash: { in: unique }, status: 'ACTIVE', id: { not: ownerId } },
          select: { id: true, phoneHash: true },
        })
      : [];
    const userByHash = new Map(registered.map((u) => [u.phoneHash, u.id]));

    await this.prisma.$transaction([
      this.prisma.contact.deleteMany({
        where: { ownerId, phoneHash: { notIn: unique } },
      }),
      ...unique.map((phoneHash) =>
        this.prisma.contact.upsert({
          where: { ownerId_phoneHash: { ownerId, phoneHash } },
          create: { ownerId, phoneHash, contactUserId: userByHash.get(phoneHash) ?? null },
          update: { contactUserId: userByHash.get(phoneHash) ?? null },
        }),
      ),
    ]);

    return this.list(ownerId);
  }
}

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const raw = this.config.get<string>('ADMIN_PHONE_HASHES');
    if (!raw) {
      return;
    }
    const phoneHashes = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    if (phoneHashes.length === 0) {
      return;
    }

    const operator = process.env.USER ?? process.env.USERNAME ?? 'unknown';
    let promoted = 0;
    let alreadyAdmin = 0;
    let missing = 0;

    for (const phoneHash of phoneHashes) {
      const user = await this.prisma.user.findUnique({
        where: { phoneHash },
        select: { id: true, role: true },
      });
      if (!user) {
        missing += 1;
        this.logger.warn(`ADMIN_PHONE_HASHES contains unknown phoneHash (no matching user)`);
        continue;
      }
      if (user.role === UserRole.ADMIN) {
        alreadyAdmin += 1;
        continue;
      }
      const previous = user.role;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { role: UserRole.ADMIN },
      });
      await this.audit.write({
        actorUserId: null,
        action: 'ROLE_PROMOTE',
        targetType: 'USER',
        targetId: user.id,
        metadata: { source: 'env', operator, from: previous, to: UserRole.ADMIN },
      });
      promoted += 1;
    }

    this.logger.log(
      `Admin bootstrap complete: promoted=${promoted} alreadyAdmin=${alreadyAdmin} missing=${missing}`,
    );
  }
}

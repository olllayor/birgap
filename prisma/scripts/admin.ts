import { createHash } from 'node:crypto';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
}

function parseArgs(argv: string[]): { command: string; phone?: string; role?: UserRole; reason?: string } {
  const [, , command, ...rest] = argv;
  if (!command || (command !== 'promote' && command !== 'demote')) {
    throw new Error('Usage: pnpm admin:<promote|demote> <phoneE164> [--role <USER|MODERATOR|ADMIN>] [--reason <text>]');
  }
  const phone = rest[0];
  if (!phone) {
    throw new Error('Phone argument is required (E.164 format, e.g. +998901112233)');
  }
  const roleIdx = rest.indexOf('--role');
  const role = roleIdx !== -1 ? (rest[roleIdx + 1] as UserRole) : undefined;
  const reasonIdx = rest.indexOf('--reason');
  const reason = reasonIdx !== -1 ? rest[reasonIdx + 1] : undefined;

  if (role && !['USER', 'MODERATOR', 'ADMIN'].includes(role)) {
    throw new Error(`Invalid --role: ${role}. Must be USER | MODERATOR | ADMIN`);
  }
  return { command, phone, role, reason };
}

async function main() {
  const { command, phone, role, reason } = parseArgs(process.argv);
  const phoneHash = hashPhone(phone!);
  const operator = process.env.USER ?? process.env.USERNAME ?? 'unknown';

  const user = await prisma.user.findUnique({
    where: { phoneHash },
    select: { id: true, role: true, phoneMasked: true },
  });
  if (!user) {
    console.error(`[admin] no user found for phoneHash ${phoneHash.slice(0, 8)}…`);
    process.exit(1);
  }

  if (command === 'demote') {
    const newRole = role ?? UserRole.USER;
    if (newRole === user.role) {
      console.log(`[admin] user ${user.phoneMasked ?? user.id} is already ${user.role}; nothing to do`);
      return;
    }
    const previous = user.role;
    await prisma.user.update({ where: { id: user.id }, data: { role: newRole } });
    const action: 'ROLE_PROMOTE' | 'ROLE_DEMOTE' =
      rank(newRole) > rank(previous) ? 'ROLE_PROMOTE' : 'ROLE_DEMOTE';
    await prisma.adminAuditLog.create({
      data: {
        actorUserId: null,
        action,
        targetType: 'USER',
        targetId: user.id,
        reason: reason ?? null,
        metadata: { source: 'cli', operator, from: previous, to: newRole },
      },
    });
    console.log(`[admin] demoted ${user.phoneMasked ?? user.id}: ${previous} → ${newRole}`);
    return;
  }

  const newRole = role ?? UserRole.ADMIN;
  if (newRole === user.role) {
    console.log(`[admin] user ${user.phoneMasked ?? user.id} is already ${user.role}; nothing to do`);
    return;
  }
  const previous = user.role;
  await prisma.user.update({ where: { id: user.id }, data: { role: newRole } });
  const action: 'ROLE_PROMOTE' | 'ROLE_DEMOTE' =
    rank(newRole) > rank(previous) ? 'ROLE_PROMOTE' : 'ROLE_DEMOTE';
  await prisma.adminAuditLog.create({
    data: {
      actorUserId: null,
      action,
      targetType: 'USER',
      targetId: user.id,
      reason: reason ?? null,
      metadata: { source: 'cli', operator, from: previous, to: newRole },
    },
  });
  console.log(`[admin] promoted ${user.phoneMasked ?? user.id}: ${previous} → ${newRole}`);
}

function rank(role: UserRole): number {
  return role === UserRole.ADMIN ? 2 : role === UserRole.MODERATOR ? 1 : 0;
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('[admin] failed:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });

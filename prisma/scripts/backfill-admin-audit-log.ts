import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type LegacyRow = {
  id: string;
  messageId: string;
  adminUserId: string;
  deletedAt: Date;
};

const BATCH_SIZE = 500;

async function alreadyBackfilled(originalId: string): Promise<boolean> {
  const row = await prisma.adminAuditLog.findFirst({
    where: {
      action: 'MESSAGE_TOMBSTONE',
      targetType: 'MESSAGE',
      metadata: {
        path: ['originalId'],
        equals: originalId,
      },
    },
    select: { id: true },
  });
  return row !== null;
}

async function main() {
  const startedAt = new Date();
  let totalSeen = 0;
  let inserted = 0;
  let skipped = 0;
  let cursor: string | undefined;

  console.log('[backfill] starting MessageAdminDeleteLog → AdminAuditLog backfill');

  while (true) {
    const batch: LegacyRow[] = await prisma.$queryRaw<LegacyRow[]>`
      SELECT "id", "messageId", "adminUserId", "deletedAt"
      FROM "MessageAdminDeleteLog"
      ${cursor ? Prisma.sql`WHERE "id" > ${cursor}` : Prisma.empty}
      ORDER BY "id" ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (batch.length === 0) {
      break;
    }

    for (const row of batch) {
      totalSeen += 1;
      if (await alreadyBackfilled(row.id)) {
        skipped += 1;
        continue;
      }
      await prisma.adminAuditLog.create({
        data: {
          actorUserId: row.adminUserId,
          action: 'MESSAGE_TOMBSTONE',
          targetType: 'MESSAGE',
          targetId: row.messageId,
          createdAt: row.deletedAt,
          metadata: {
            source: 'legacy',
            originalId: row.id,
            scope: 'group',
          },
        },
      });
      inserted += 1;
    }

    cursor = batch[batch.length - 1].id;
    console.log(`[backfill] progress: seen=${totalSeen} inserted=${inserted} skipped=${skipped} cursor=${cursor}`);
  }

  const finishedAt = new Date();
  const seconds = ((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(2);
  console.log(
    `[backfill] done in ${seconds}s — seen=${totalSeen} inserted=${inserted} skipped=${skipped} (skipped = already backfilled on a previous run)`,
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('[backfill] failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });

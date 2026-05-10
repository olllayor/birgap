import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

function hashPhone(phone: string) {
  return createHash('sha256').update(phone).digest('hex');
}

async function main() {
  const phones = ['+998901112233', '+998902223344'];

  for (const phone of phones) {
    await prisma.user.upsert({
      where: { phoneHash: hashPhone(phone) },
      update: {},
      create: {
        phoneHash: hashPhone(phone),
        phoneMasked: `${phone.slice(0, 6)}****${phone.slice(-2)}`,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

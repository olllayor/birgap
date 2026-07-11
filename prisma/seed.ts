import { PrismaClient, DevicePlatform, Prisma } from '@prisma/client';
import { createCipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { hmacSha256, maskPhone, normalizePhone } from '../src/common/utils/crypto.util';

const prisma = new PrismaClient();

const PEPPER = process.env.PHONE_HASH_PEPPER ?? 'dev-seed-pepper-not-for-prod';

function hashPhone(phone: string) {
  return hmacSha256(normalizePhone(phone), PEPPER);
}

// ─── Crypto matching the Swift client (CryptoService) ───────────────────────
//
// Seeded data must be PROTOCOL-COMPATIBLE or the app chokes on it:
// - device identityPublicKey = P-256 public key, RAW 64-byte X||Y, base64
//   (a random 32-byte blob makes every send to that device fail with
//   invalidKey — that bug shipped in the first version of this seed).
// - DM envelope ciphertext = {type:"signal-message", body:<b64 ECIES v2>}.
// - group metadata = {v:2, payload:<AES-GCM(groupKey,{name})>,
//   keys:{deviceId:{w:<ECIES wrap of groupKey>, pk:<target key>}}}.
// - group envelope ciphertext = {type:"group-v1", body:<b64 AES-GCM>}.

function generateP256KeyPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  // Node returns the uncompressed point (0x04 || X || Y); CryptoKit's
  // rawRepresentation is X || Y without the prefix.
  return { publicKeyRawBase64: ecdh.getPublicKey().subarray(1).toString('base64') };
}

function aesGcmSeal(plaintext: Buffer, key: Buffer): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // CryptoKit "combined" layout: nonce || ciphertext || tag
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]);
}

/** ECIES exactly like CryptoService.encryptForDevice (v2 payload, b64-wrapped JSON). */
function eciesEncrypt(plaintext: Buffer, recipientPublicKeyRawBase64: string): string {
  const recipientRaw = Buffer.from(recipientPublicKeyRawBase64, 'base64');
  if (recipientRaw.length !== 64) {
    throw new Error('recipient key is not a raw P-256 public key');
  }
  const recipientUncompressed = Buffer.concat([Buffer.from([0x04]), recipientRaw]);

  const ephemeral = createECDH('prime256v1');
  ephemeral.generateKeys();
  const sharedSecret = ephemeral.computeSecret(recipientUncompressed);
  const symmetricKey = Buffer.from(
    hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.from('BirGap-E2EE-v2'), 32),
  );

  const payload = {
    version: 2,
    ephemeralKey: ephemeral.getPublicKey().subarray(1).toString('base64'),
    signedPrekeyId: null,
    ciphertext: aesGcmSeal(plaintext, symmetricKey).toString('base64'),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function dmCiphertext(text: string, recipientPublicKey: string) {
  return { type: 'signal-message', body: eciesEncrypt(Buffer.from(text, 'utf8'), recipientPublicKey) };
}

function groupCiphertext(text: string, groupKey: Buffer) {
  return { type: 'group-v1', body: aesGcmSeal(Buffer.from(text, 'utf8'), groupKey).toString('base64') };
}

// ─────────────────────────────────────────────────────────────────────────────

const USERS = [
  { phone: '+998901112233', username: 'aziz', role: 'ADMIN' as const },
  { phone: '+998902223344', username: 'dilnoza', role: 'USER' as const },
  { phone: '+998903334455', username: 'jasur', role: 'USER' as const },
  { phone: '+998904445566', username: 'malika', role: 'USER' as const },
];

const GROUP_NAME = "BirGap do'stlar";

function isRawP256(key: string | null): boolean {
  return !!key && Buffer.from(key, 'base64').length === 64;
}

async function seedUsersAndDevices() {
  const users: { id: string; phone: string; deviceId: string; devicePublicKey: string; username: string }[] = [];

  for (const u of USERS) {
    const phoneHash = hashPhone(u.phone);
    const user = await prisma.user.upsert({
      where: { phoneHash },
      update: {},
      create: {
        phoneHash,
        phoneMasked: maskPhone(u.phone),
        username: u.username,
        role: u.role,
      },
    });

    let device = await prisma.device.findFirst({ where: { userId: user.id } });
    if (!device) {
      device = await prisma.device.create({
        data: {
          userId: user.id,
          platform: DevicePlatform.ANDROID,
          displayName: `${u.username}'s phone`,
          identityPublicKey: generateP256KeyPair().publicKeyRawBase64,
          active: true,
        },
      });
    } else if (!isRawP256(device.identityPublicKey)) {
      // Heal devices seeded by the old script (random 32-byte keys).
      device = await prisma.device.update({
        where: { id: device.id },
        data: { identityPublicKey: generateP256KeyPair().publicKeyRawBase64 },
      });
    }

    users.push({
      id: user.id,
      phone: u.phone,
      deviceId: device.id,
      devicePublicKey: device.identityPublicKey!,
      username: u.username,
    });
  }

  return users;
}

type SeededUser = Awaited<ReturnType<typeof seedUsersAndDevices>>[number];

async function seedDirectThread(userA: SeededUser, userB: SeededUser) {
  const existing = await prisma.directThread.findFirst({
    where: {
      OR: [
        { userAId: userA.id, userBId: userB.id },
        { userAId: userB.id, userBId: userA.id },
      ],
    },
  });
  if (existing) return existing;

  const thread = await prisma.directThread.create({
    data: { userAId: userA.id, userBId: userB.id },
  });

  const lines = [
    { from: userA, text: 'Salom! Qandaysan?' },
    { from: userB, text: "Zo'r, rahmat! O'zing-chi?" },
    { from: userA, text: "Yaxshi, ishlar ko'p :)" },
  ];

  let seq = 0;
  for (const line of lines) {
    seq += 1;
    const recipient = line.from.id === userA.id ? userB : userA;
    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        senderUserId: line.from.id,
        senderDeviceId: line.from.deviceId,
        idempotencyKey: randomUUID(),
        threadSequence: seq,
      },
    });
    await prisma.messageEnvelope.create({
      data: {
        messageId: message.id,
        recipientUserId: recipient.id,
        recipientDeviceId: recipient.deviceId,
        ciphertext: dmCiphertext(line.text, recipient.devicePublicKey) as Prisma.InputJsonValue,
      },
    });
  }

  await prisma.directThread.update({ where: { id: thread.id }, data: { latestSequence: seq } });
  return thread;
}

/** Wrap the group key for every ACTIVE device in the database (seeded AND
 *  real app devices), so a real logged-in user added to the seeded group can
 *  actually read and send. Devices with non-P256 keys (old smoke-test rows)
 *  are skipped. */
async function buildGroupMetadata(groupKey: Buffer) {
  const devices = await prisma.device.findMany({
    where: { active: true },
    select: { id: true, identityPublicKey: true },
  });

  const keys: Record<string, { w: string; pk: string }> = {};
  for (const device of devices) {
    if (!isRawP256(device.identityPublicKey)) continue;
    keys[device.id] = {
      w: eciesEncrypt(groupKey, device.identityPublicKey!),
      pk: device.identityPublicKey!,
    };
  }

  return {
    v: 2,
    payload: aesGcmSeal(Buffer.from(JSON.stringify({ name: GROUP_NAME }), 'utf8'), groupKey).toString('base64'),
    keys,
  };
}

async function seedGroup(members: SeededUser[]) {
  const memberIds = members.map((m) => m.id);
  const groupKey = randomBytes(32);
  const metadata = (await buildGroupMetadata(groupKey)) as unknown as Prisma.InputJsonValue;

  const existing = await prisma.group.findFirst({
    where: { members: { every: { userId: { in: memberIds } }, some: {} } },
  });
  if (existing) {
    // Heal a group seeded by the old script (placeholder metadata, no wraps):
    // fresh key, fresh wraps, and re-seal its message envelopes so they decrypt.
    const meta = existing.encryptedMetadata as { v?: number } | null;
    if (!meta || meta.v === undefined) {
      await prisma.group.update({ where: { id: existing.id }, data: { encryptedMetadata: metadata } });
      const messages = await prisma.message.findMany({ where: { groupId: existing.id } });
      const texts = ['Guruhga xush kelibsiz!', 'Rahmat, salom hammaga'];
      for (const [i, message] of messages.entries()) {
        await prisma.messageEnvelope.updateMany({
          where: { messageId: message.id },
          data: { ciphertext: groupCiphertext(texts[i % texts.length], groupKey) as Prisma.InputJsonValue },
        });
      }
    }
    return existing;
  }

  const group = await prisma.group.create({
    data: {
      encryptedMetadata: metadata,
      members: {
        create: members.map((m, i) => ({ userId: m.id, role: i === 0 ? 'ADMIN' : 'MEMBER' })),
      },
    },
  });

  const lines = [
    { from: members[0], text: 'Guruhga xush kelibsiz!' },
    { from: members[1], text: 'Rahmat, salom hammaga' },
  ];

  let seq = 0;
  let firstMessageId: string | null = null;
  for (const line of lines) {
    seq += 1;
    const message = await prisma.message.create({
      data: {
        groupId: group.id,
        senderUserId: line.from.id,
        senderDeviceId: line.from.deviceId,
        idempotencyKey: randomUUID(),
        threadSequence: seq,
      },
    });
    if (!firstMessageId) firstMessageId = message.id;

    const recipients = members.filter((m) => m.id !== line.from.id);
    await prisma.messageEnvelope.createMany({
      data: recipients.map((r) => ({
        messageId: message.id,
        recipientUserId: r.id,
        recipientDeviceId: r.deviceId,
        ciphertext: groupCiphertext(line.text, groupKey) as Prisma.InputJsonValue,
      })),
    });
  }

  if (firstMessageId) {
    await prisma.messageReaction.create({
      data: { messageId: firstMessageId, userId: members[1].id, emoji: '👍' },
    });
  }

  return group;
}

async function main() {
  const users = await seedUsersAndDevices();
  await seedDirectThread(users[0], users[1]);
  await seedGroup(users);
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

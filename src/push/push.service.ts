import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface PushEnvelopeTarget {
  recipientDeviceId: string;
  recipientUserId: string;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendMessageWakeup(envelopes: PushEnvelopeTarget[]) {
    const deviceIds = [...new Set(envelopes.map((envelope) => envelope.recipientDeviceId))];
    const devices = await this.prisma.device.findMany({
      where: { id: { in: deviceIds }, active: true, pushToken: { not: null } },
      select: {
        id: true,
        userId: true,
        pushToken: true,
        pushPlatform: true,
        pushActive: true,
      },
    });

    const targets = [...new Set(devices.map((device) => device.userId))].flatMap((userId) => {
      const userDevices = devices.filter((device) => device.userId === userId);
      const activeTargets = userDevices.filter((device) => device.pushActive);
      return activeTargets.length > 0 ? activeTargets : userDevices;
    });

    for (const target of targets) {
      this.logger.log(
        `Push wakeup queued user=${target.userId} device=${target.id} platform=${target.pushPlatform ?? 'unknown'}`,
      );
    }
  }
}

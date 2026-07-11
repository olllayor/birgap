import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import type { Update } from 'telegraf/types';
import { PrismaService } from '../prisma/prisma.service';
import { SmsProvider, SmsType } from '@prisma/client';
import { hmacSha256, normalizePhone } from '../common/utils/crypto.util';

export interface SendOtpParams {
  phoneHash: string;
  phone: string;
  code: string;
}

export interface SendOtpResult {
  success: boolean;
  error?: string;
}

/**
 * Runs the Telegram bot in webhook mode and delivers OTP codes to users who
 * have linked their phone via the /start → share-contact flow. The link table
 * (phoneHash → chatId) is populated here and read by {@link sendOtp}.
 *
 * Telegram is the sole OTP delivery channel — requestOtp() rejects unlinked
 * phones rather than falling back to another provider.
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private bot: Telegraf | null = null;
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.webhookSecret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? '';
  }

  async onModuleInit(): Promise<void> {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is missing — bot disabled, OTP delivery will fail');
      return;
    }

    this.bot = new Telegraf(token);
    this.registerHandlers(this.bot);

    const baseUrl = this.config.getOrThrow<string>('TELEGRAM_WEBHOOK_URL').replace(/\/$/, '');
    const path = this.config.get<string>('TELEGRAM_WEBHOOK_PATH') ?? '/telegram/webhook';
    const webhookUrl = `${baseUrl}${path}`;

    try {
      await this.bot.telegram.setWebhook(webhookUrl, {
        secret_token: this.webhookSecret || undefined,
        allowed_updates: ['message'],
        drop_pending_updates: true,
      });
      this.logger.log(`Telegram webhook registered at ${webhookUrl}`);
    } catch (error) {
      this.logger.error(
        `Failed to register Telegram webhook: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Webhook mode holds no long-lived connection; nothing to tear down.
    this.bot = null;
  }

  get enabled(): boolean {
    return this.bot !== null;
  }

  /** Verifies the secret Telegram echoes back and dispatches the update. */
  async handleWebhook(update: Update, secretToken: string | undefined): Promise<boolean> {
    if (!this.bot) {
      return false;
    }
    if (this.webhookSecret && secretToken !== this.webhookSecret) {
      this.logger.warn('Rejected Telegram webhook with invalid secret token');
      return false;
    }
    await this.bot.handleUpdate(update);
    return true;
  }

  /**
   * Delivers an OTP code to a linked Telegram chat. Returns success=false (not a
   * throw) when the phone isn't linked, so the caller can fall back to SMS.
   */
  async sendOtp(params: SendOtpParams): Promise<SendOtpResult> {
    if (!this.bot) {
      return { success: false, error: 'Telegram bot not configured' };
    }

    const link = await this.prisma.telegramLink.findUnique({
      where: { phoneHash: params.phoneHash },
    });

    if (!link) {
      return { success: false, error: 'No Telegram link for this phone' };
    }

    try {
      await this.bot.telegram.sendMessage(
        link.chatId.toString(),
        `🔐 Your BirGap verification code: ${params.code}\n\nDo not share this code with anyone.`,
      );

      await this.prisma.smsReport.create({
        data: {
          phoneHash: params.phoneHash,
          type: SmsType.OTP,
          provider: SmsProvider.TELEGRAM,
          success: true,
        },
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Telegram OTP send failed: ${errorMessage}`);

      await this.prisma.smsReport.create({
        data: {
          phoneHash: params.phoneHash,
          type: SmsType.OTP,
          provider: SmsProvider.TELEGRAM,
          success: false,
          error: errorMessage,
        },
      });

      return { success: false, error: errorMessage };
    }
  }

  private registerHandlers(bot: Telegraf): void {
    bot.start(async (ctx) => {
      await ctx.reply(
        'Welcome to BirGap 👋\n\nTap the button below to share your phone number so we can send you login codes here.',
        Markup.keyboard([Markup.button.contactRequest('📱 Share my phone number')])
          .oneTime()
          .resize(),
      );
    });

    bot.on(message('contact'), async (ctx) => {
      const contact = ctx.message.contact;

      // Reject contacts shared on behalf of someone else — only the sender's own
      // number may be linked to their chat.
      if (contact.user_id !== ctx.from.id) {
        await ctx.reply('Please share your own phone number using the button, not a saved contact.');
        return;
      }

      const pepper = this.config.getOrThrow<string>('PHONE_HASH_PEPPER');
      const normalizedPhone = normalizePhone(contact.phone_number);
      const phoneHash = hmacSha256(normalizedPhone, pepper);

      await this.prisma.telegramLink.upsert({
        where: { phoneHash },
        create: {
          phoneHash,
          chatId: BigInt(ctx.chat.id),
          telegramUserId: BigInt(ctx.from.id),
          username: ctx.from.username ?? null,
        },
        update: {
          chatId: BigInt(ctx.chat.id),
          telegramUserId: BigInt(ctx.from.id),
          username: ctx.from.username ?? null,
        },
      });

      await ctx.reply(
        '✅ You are all set! Your login codes will now be delivered here in Telegram.',
        Markup.removeKeyboard(),
      );
    });
  }
}

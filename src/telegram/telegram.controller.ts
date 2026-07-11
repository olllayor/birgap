import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Update } from 'telegraf/types';
import { TelegramBotService } from './telegram-bot.service';

/**
 * Receives Telegram webhook updates. The path must match TELEGRAM_WEBHOOK_PATH
 * (default /telegram/webhook), which is what {@link TelegramBotService} registers
 * with Telegram on startup. Authenticity is verified via the secret token header.
 */
@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramBot: TelegramBotService) {}

  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  async webhook(
    @Body() update: Update,
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
  ): Promise<{ ok: boolean }> {
    // Always ACK with 200 so Telegram doesn't retry; invalid/secret-failed
    // updates are simply dropped inside handleWebhook.
    await this.telegramBot.handleWebhook(update, secretToken);
    return { ok: true };
  }
}

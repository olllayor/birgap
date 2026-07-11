import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { TelegramBotService } from '../telegram-bot.service';
import { TelegramOtpJobData } from './telegram-otp-job.interface';
import { TELEGRAM_OTP_QUEUE } from '../telegram.tokens';
import { QueueMetrics } from '../../metrics/queue.metrics';

@Processor(TELEGRAM_OTP_QUEUE, { concurrency: 3 })
export class TelegramOtpProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramOtpProcessor.name);

  constructor(
    private readonly telegramBot: TelegramBotService,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<TelegramOtpJobData>): Promise<void> {
    const { phoneHash, phone, code } = job.data;
    const result = await this.telegramBot.sendOtp({ phoneHash, phone, code });
    if (!result.success) {
      throw new Error(result.error ?? 'Telegram provider returned failure');
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<TelegramOtpJobData>) {
    this.queueMetrics.recordCompleted(TELEGRAM_OTP_QUEUE);
    this.logger.debug(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<TelegramOtpJobData>, error: Error) {
    this.queueMetrics.recordFailed(TELEGRAM_OTP_QUEUE);
    this.logger.warn(
      `Job ${job.id} failed — attempt ${job.attemptsMade}/${job.opts.attempts}: ${error.message}`,
    );
  }
}

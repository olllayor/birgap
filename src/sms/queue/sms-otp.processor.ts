import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SmsService, SMS_SERVICE_TOKEN } from '../sms.module';
import { SmsOtpJobData } from './sms-otp-job.interface';
import { QueueMetrics } from '../../metrics/queue.metrics';

@Processor('sms-otp', { concurrency: 3 })
export class SmsOtpProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsOtpProcessor.name);

  constructor(
    @Inject(SMS_SERVICE_TOKEN)
    private readonly smsService: SmsService,
    private readonly queueMetrics: QueueMetrics,
  ) {
    super();
  }

  async process(job: Job<SmsOtpJobData>): Promise<void> {
    const { phoneHash, phone, code } = job.data;
    const result = await this.smsService.sendOtp({ phoneHash, phone, code });
    if (!result.success) {
      throw new Error(result.error ?? 'SMS provider returned failure');
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<SmsOtpJobData>) {
    this.queueMetrics.recordCompleted('sms-otp');
    this.logger.debug(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<SmsOtpJobData>, error: Error) {
    this.queueMetrics.recordFailed('sms-otp');
    this.logger.warn(
      `Job ${job.id} failed — attempt ${job.attemptsMade}/${job.opts.attempts}: ${error.message}`,
    );
  }
}

import { Job } from 'bullmq';
import { SmsService, SMS_SERVICE_TOKEN } from '../sms.module';
import { SmsOtpJobData } from './sms-otp-job.interface';
import { SmsOtpProcessor } from './sms-otp.processor';
import { QueueMetrics } from '../../metrics/queue.metrics';

describe('SmsOtpProcessor', () => {
  let processor: SmsOtpProcessor;
  let smsService: SmsService;
  let queueMetrics: QueueMetrics;

  beforeEach(() => {
    smsService = {
      sendOtp: jest.fn(),
    } as unknown as SmsService;

    queueMetrics = {
      recordCompleted: jest.fn(),
      recordFailed: jest.fn(),
    } as unknown as QueueMetrics;

    processor = new SmsOtpProcessor(smsService, queueMetrics);
  });

  it('calls smsService.sendOtp with job data and succeeds', async () => {
    (smsService.sendOtp as jest.Mock).mockResolvedValue({ success: true });

    const job = {
      id: 'job-1',
      data: {
        phoneHash: 'hash-123',
        phone: '+998901234567',
        code: '123456',
      },
    } as unknown as Job<SmsOtpJobData>;

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(smsService.sendOtp).toHaveBeenCalledWith({
      phoneHash: 'hash-123',
      phone: '+998901234567',
      code: '123456',
    });
  });

  it('throws when smsService returns failure', async () => {
    (smsService.sendOtp as jest.Mock).mockResolvedValue({
      success: false,
      error: 'Provider timeout',
    });

    const job = {
      id: 'job-2',
      data: {
        phoneHash: 'hash-456',
        phone: '+998909876543',
        code: '654321',
      },
    } as unknown as Job<SmsOtpJobData>;

    await expect(processor.process(job)).rejects.toThrow('Provider timeout');
  });

  it('throws with default message when smsService returns failure without error', async () => {
    (smsService.sendOtp as jest.Mock).mockResolvedValue({ success: false });

    const job = {
      id: 'job-3',
      data: {
        phoneHash: 'hash-789',
        phone: '+998900000000',
        code: '000000',
      },
    } as unknown as Job<SmsOtpJobData>;

    await expect(processor.process(job)).rejects.toThrow(
      'SMS provider returned failure',
    );
  });
});

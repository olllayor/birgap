import { SayqalSmsService } from './sayqal-sms.service';
import { MockSmsService } from './mock-sms.service';

export const SMS_SERVICE_TOKEN = 'SMS_SERVICE';

export type SmsService = SayqalSmsService | MockSmsService;

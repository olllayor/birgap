import { SayqalSmsService } from './sayqal-sms.service';
import { MockSmsService } from './mock-sms.service';

export type SmsService = SayqalSmsService | MockSmsService;
export const SMS_SERVICE_TOKEN = 'SMS_SERVICE';

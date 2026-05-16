# Sayqal SMS Provider - Integration Guide

## Overview

Sayqal is an SMS gateway provider used for sending OTP verification codes and transactional messages. This guide covers everything needed to integrate Sayqal into any project.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [API Authentication](#api-authentication)
4. [Endpoints](#endpoints)
5. [Core Implementation](#core-implementation)
6. [OTP Flow](#otp-flow)
7. [SMS Reports](#sms-reports)
8. [Error Handling & Fallback](#error-handling--fallback)
9. [Testing](#testing)
10. [Production Checklist](#production-checklist)

---

## Prerequisites

### Credentials Required

Contact Sayqal to obtain:

| Credential | Description | Example |
|------------|-------------|---------|
| `SMS_SAYQAL_URL` | Base API URL | `https://sayqal.uz/api` |
| `SMS_SAYQAL_SECRET` | Secret key for token generation | `a1b2c3d4e5f6...` |
| `username` | Your account username | `yourcompany` |

### Dependencies

```bash
npm install axios dayjs
# or
yarn add axios dayjs
# or
pnpm add axios dayjs
```

---

## Environment Setup

Create `.env` file:

```env
# Sayqal SMS Configuration
SMS_SAYQAL_URL=https://sayqal.uz/api
SMS_SAYQAL_SECRET=your_secret_key_here
SMS_SAYQAL_USERNAME=your_username

# Optional: Fallback SMS provider
SMS_FALLBACK_URL=https://fallback-provider.com/api
SMS_FALLBACK_TOKEN=your_fallback_token
```

---

## API Authentication

Sayqal uses a custom token-based authentication via the `X-Access-Token` header.

### Token Generation

```
X-Access-Token = MD5("{endpoint} {username} {secret} {utime}")
```

Where:
- `endpoint` - The API method name (e.g., `TransmitSMS`, `DetalSMS`)
- `username` - Your account username
- `secret` - Your secret key
- `utime` - Current Unix timestamp in seconds

### Example (Node.js)

```typescript
import { createHash } from 'crypto';

function generateToken(endpoint: string, username: string, secret: string, utime: number): string {
  return createHash('md5')
    .update(`${endpoint} ${username} ${secret} ${utime}`)
    .digest('hex');
}

// Usage
const utime = Math.floor(Date.now() / 1000);
const token = generateToken('TransmitSMS', 'mycompany', 'secret123', utime);
// Result: "a1b2c3d4e5f6..."
```

---

## Endpoints

### 1. TransmitSMS - Send SMS

**URL:** `{SMS_SAYQAL_URL}/sms/TransmitSMS`
**Method:** `POST`

#### Request Body

```json
{
  "utime": 1700000000,
  "username": "your_username",
  "service": {
    "service": 2
  },
  "message": {
    "smsid": "1700000000",
    "phone": "998901234567",
    "text": "Your verification code: 4821"
  }
}
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `utime` | number | Yes | Unix timestamp (seconds) |
| `username` | string | Yes | Account username |
| `service.service` | number | Yes | `2` = OTP, `4` = Regular message |
| `message.smsid` | string | Yes | Unique message identifier |
| `message.phone` | string | Yes | Phone number (digits only) |
| `message.text` | string | Yes | Message content |

#### Headers

```
Content-Type: application/json
X-Access-Token: {generated_md5_token}
```

---

### 2. DetalSMS - Check SMS Status

**URL:** `{SMS_SAYQAL_URL}/sms/DetalSMS`
**Method:** `POST`

#### Request Body

```json
{
  "utime": 1700000000,
  "username": "your_username",
  "phone": "998901234567",
  "datebegin": "2024-01-15 10:00:00",
  "dateend": "2024-01-15 10:01:00"
}
```

#### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `utime` | number | Yes | Unix timestamp (seconds) |
| `username` | string | Yes | Account username |
| `phone` | string | Yes | Phone number to check |
| `datebegin` | string | Yes | Start date (YYYY-MM-DD hh:mm:ss) |
| `dateend` | string | Yes | End date (YYYY-MM-DD hh:mm:ss) |

---

## Core Implementation

### sayqal-sms.service.ts

```typescript
import axios, { AxiosRequestConfig } from 'axios';
import { createHash } from 'crypto';

export interface SendOtpParams {
  phone: string;
  code: number;
  signature?: string;
}

export interface SendMessageParams {
  phone: string;
  message: string;
}

export interface CheckSmsStatusParams {
  phone: string;
  datebegin?: string;
  dateend?: string;
}

export interface SayqalResponse {
  status?: number;
  message?: string;
  [key: string]: any;
}

export class SayqalSmsService {
  private baseUrl: string;
  private secretKey: string;
  private username: string;

  constructor(config: { baseUrl: string; secretKey: string; username: string }) {
    this.baseUrl = config.baseUrl;
    this.secretKey = config.secretKey;
    this.username = config.username;
  }

  /**
   * Generate MD5 authentication token
   */
  private generateToken(endpoint: string, utime: number): string {
    return createHash('md5')
      .update(`${endpoint} ${this.username} ${this.secretKey} ${utime}`)
      .digest('hex');
  }

  /**
   * Send OTP verification code
   */
  async sendOtp({ phone, code, signature = '' }: SendOtpParams): Promise<SayqalResponse> {
    const utime = Math.floor(Date.now() / 1000);

    const message = signature
      ? `Verification code: ${code}\n${signature}`
      : `Verification code: ${code}`;

    return this.transmitSms({
      phone,
      text: message,
      serviceType: 2, // OTP service
      utime,
    });
  }

  /**
   * Send regular SMS message
   */
  async sendMessage({ phone, message }: SendMessageParams): Promise<SayqalResponse> {
    const utime = Math.floor(Date.now() / 1000);

    return this.transmitSms({
      phone,
      text: message,
      serviceType: 4, // Regular message service
      utime,
    });
  }

  /**
   * Core SMS transmission method
   */
  private async transmitSms(params: {
    phone: string;
    text: string;
    serviceType: number;
    utime: number;
  }): Promise<SayqalResponse> {
    const { phone, text, serviceType, utime } = params;

    const config: AxiosRequestConfig = {
      headers: {
        'X-Access-Token': this.generateToken('TransmitSMS', utime),
        'Content-Type': 'application/json',
      },
    };

    const body = {
      utime,
      username: this.username,
      service: { service: serviceType },
      message: {
        smsid: String(utime),
        phone: String(+phone), // Ensure numeric string
        text,
      },
    };

    const response = await axios.post(
      `${this.baseUrl}/sms/TransmitSMS`,
      body,
      config,
    );

    return response.data;
  }

  /**
   * Check SMS delivery status
   */
  async checkSmsStatus({ phone, datebegin, dateend }: CheckSmsStatusParams): Promise<SayqalResponse> {
    const utime = Math.floor(Date.now() / 1000);

    const now = new Date();
    const defaultBegin = new Date(now.getTime() - 45000).toISOString().replace('T', ' ').substring(0, 19);
    const defaultEnd = now.toISOString().replace('T', ' ').substring(0, 19);

    const config: AxiosRequestConfig = {
      headers: {
        'X-Access-Token': this.generateToken('DetalSMS', utime),
        'Content-Type': 'application/json',
      },
    };

    const body = {
      utime,
      username: this.username,
      phone: String(+phone),
      datebegin: datebegin || defaultBegin,
      dateend: dateend || defaultEnd,
    };

    const response = await axios.post(
      `${this.baseUrl}/sms/DetalSMS`,
      body,
      config,
    );

    return response.data;
  }
}
```

---

## OTP Flow

### otp.schema.ts

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum OtpStatus {
  USED = 'USED',
  UNUSED = 'UNUSED',
  EXPIRED = 'EXPIRED',
}

export type OtpDocument = HydratedDocument<Otp>;

@Schema({ timestamps: true })
export class Otp {
  @Prop({ type: Number })
  phone: number;

  @Prop({ type: String })
  email: string;

  @Prop({ type: Number, required: true })
  code: number;

  @Prop({ type: String, enum: OtpStatus, default: OtpStatus.UNUSED })
  status: OtpStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const OtpSchema = SchemaFactory.createForClass(Otp);

// Index for efficient queries
OtpSchema.index({ phone: 1, status: 1, createdAt: 1 });
OtpSchema.index({ createdAt: 1 });
```

### otp.service.ts

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as dayjs from 'dayjs';
import { Otp, OtpStatus } from './otp.schema';
import { SayqalSmsService } from './sayqal-sms.service';

@Injectable()
export class OtpService {
  private readonly OTP_EXPIRY_MINUTES = 10;
  private readonly RESEND_COOLDOWN_MINUTES = 2;

  constructor(
    @InjectModel(Otp.name) private otpModel: Model<Otp>,
    private sayqalService: SayqalSmsService,
  ) {}

  /**
   * Generate and send OTP
   */
  async sendOtp(phone: string, signature = '') {
    // Normalize phone number
    const normalizedPhone = this.normalizePhone(phone);

    // Check for recent OTP (rate limiting)
    const recentOtp = await this.otpModel.findOne({
      phone: normalizedPhone,
      status: OtpStatus.UNUSED,
      createdAt: { $gte: dayjs().subtract(this.RESEND_COOLDOWN_MINUTES, 'minutes').toDate() },
    });

    if (recentOtp) {
      return {
        success: true,
        message: `OTP already sent. Please wait ${this.RESEND_COOLDOWN_MINUTES} minutes before requesting a new one.`,
        createdAt: recentOtp.createdAt,
        canResendAt: dayjs(recentOtp.createdAt).add(this.RESEND_COOLDOWN_MINUTES, 'minutes').toDate(),
      };
    }

    // Generate 4-digit code
    const code = this.generateOtpCode();

    // Save OTP to database
    await this.otpModel.create({
      phone: normalizedPhone,
      code,
      status: OtpStatus.UNUSED,
    });

    // Send via Sayqal
    try {
      await this.sayqalService.sendOtp({
        phone: normalizedPhone,
        code,
        signature,
      });
    } catch (error) {
      // If Sayqal fails, you can implement fallback here
      console.error('Sayqal SMS failed:', error);
      throw new BadRequestException('Failed to send OTP. Please try again.');
    }

    return {
      success: true,
      message: 'OTP sent successfully',
    };
  }

  /**
   * Verify OTP code
   */
  async verifyOtp(phone: string, code: number) {
    const normalizedPhone = this.normalizePhone(phone);

    const otp = await this.otpModel.findOne({
      phone: normalizedPhone,
      code,
      status: OtpStatus.UNUSED,
      createdAt: { $gte: dayjs().subtract(this.OTP_EXPIRY_MINUTES, 'minutes').toDate() },
    });

    if (!otp) {
      throw new NotFoundException('Invalid or expired OTP');
    }

    // Mark as used
    otp.status = OtpStatus.USED;
    await otp.save();

    return {
      success: true,
      message: 'OTP verified successfully',
    };
  }

  /**
   * Generate random OTP code
   */
  private generateOtpCode(): number {
    return Math.floor(1000 + Math.random() * 9000);
  }

  /**
   * Normalize phone number to digits only
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }
}
```

---

## SMS Reports

### sms-report.schema.ts

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum SmsProvider {
  SAYQAL = 'SAYQAL',
  FALLBACK = 'FALLBACK',
}

export enum SmsType {
  OTP = 'OTP',
  MESSAGE = 'MESSAGE',
  NOTIFICATION = 'NOTIFICATION',
}

export type SmsReportDocument = HydratedDocument<SmsReport>;

@Schema({ timestamps: true })
export class SmsReport {
  @Prop({ type: String })
  message: string;

  @Prop({ type: String, required: true })
  phone: string;

  @Prop({ type: String, enum: SmsType, required: true })
  type: SmsType;

  @Prop({ type: String, enum: SmsProvider, required: true })
  provider: SmsProvider;

  @Prop({ type: Boolean, default: true })
  success: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const SmsReportSchema = SchemaFactory.createForClass(SmsReport);
SmsReportSchema.index({ phone: 1, createdAt: -1 });
SmsReportSchema.index({ provider: 1, type: 1 });
```

### Usage in SMS Service

```typescript
// After sending SMS, log the report
async logSmsReport(params: {
  phone: string;
  message: string;
  type: SmsType;
  provider: SmsProvider;
  success: boolean;
}) {
  await this.smsReportModel.create({
    phone: params.phone,
    message: params.message,
    type: params.type,
    provider: params.provider,
    success: params.success,
  });
}
```

---

## Error Handling & Fallback

### With Fallback Provider

```typescript
export class SmsService {
  constructor(
    private sayqalService: SayqalSmsService,
    private fallbackService: FallbackSmsService, // Your backup provider
    @InjectModel(SmsReport.name) private smsReportModel: Model<SmsReport>,
  ) {}

  async sendOtp(phone: string, code: number, signature = '') {
    try {
      // Try Sayqal first
      await this.sayqalService.sendOtp({ phone, code, signature });

      await this.logSmsReport({
        phone,
        message: String(code),
        type: SmsType.OTP,
        provider: SmsProvider.SAYQAL,
        success: true,
      });

      return { success: true, provider: 'SAYQAL' };
    } catch (sayqalError) {
      console.error('Sayqal failed, trying fallback:', sayqalError);

      try {
        // Fallback to secondary provider
        await this.fallbackService.sendOtp({ phone, code });

        await this.logSmsReport({
          phone,
          message: String(code),
          type: SmsType.OTP,
          provider: SmsProvider.FALLBACK,
          success: true,
        });

        return { success: true, provider: 'FALLBACK' };
      } catch (fallbackError) {
        await this.logSmsReport({
          phone,
          message: String(code),
          type: SmsType.OTP,
          provider: SmsProvider.FALLBACK,
          success: false,
        });

        throw new Error('All SMS providers failed');
      }
    }
  }
}
```

---

## Testing

### Unit Test Example

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { OtpService } from './otp.service';
import { SayqalSmsService } from './sayqal-sms.service';
import { Otp, OtpStatus } from './otp.schema';

describe('OtpService', () => {
  let service: OtpService;
  let sayqalService: SayqalSmsService;

  const mockOtpModel = {
    findOne: jest.fn(),
    create: jest.fn(),
  };

  const mockSayqalService = {
    sendOtp: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: getModelToken(Otp.name), useValue: mockOtpModel },
        { provide: SayqalSmsService, useValue: mockSayqalService },
      ],
    }).compile();

    service = module.get<OtpService>(OtpService);
    sayqalService = module.get<SayqalSmsService>(SayqalSmsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendOtp', () => {
    it('should send new OTP successfully', async () => {
      mockOtpModel.findOne.mockResolvedValue(null);
      mockOtpModel.create.mockResolvedValue({ phone: '998901234567', code: 4821 });
      mockSayqalService.sendOtp.mockResolvedValue({ status: 'ok' });

      const result = await service.sendOtp('998901234567');

      expect(result.success).toBe(true);
      expect(mockOtpModel.create).toHaveBeenCalled();
      expect(mockSayqalService.sendOtp).toHaveBeenCalled();
    });

    it('should not resend within cooldown period', async () => {
      const recentOtp = {
        phone: '998901234567',
        status: OtpStatus.UNUSED,
        createdAt: new Date(),
      };
      mockOtpModel.findOne.mockResolvedValue(recentOtp);

      const result = await service.sendOtp('998901234567');

      expect(result.success).toBe(true);
      expect(result.message).toContain('already sent');
      expect(mockOtpModel.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('should verify valid OTP', async () => {
      const validOtp = {
        phone: '998901234567',
        code: 4821,
        status: OtpStatus.UNUSED,
        createdAt: new Date(),
        save: jest.fn(),
      };
      mockOtpModel.findOne.mockResolvedValue(validOtp);

      const result = await service.verifyOtp('998901234567', 4821);

      expect(result.success).toBe(true);
      expect(validOtp.save).toHaveBeenCalled();
    });

    it('should reject invalid OTP', async () => {
      mockOtpModel.findOne.mockResolvedValue(null);

      await expect(service.verifyOtp('998901234567', 0000))
        .rejects.toThrow('Invalid or expired OTP');
    });
  });
});
```

### Manual Testing

```bash
# Test token generation
node -e "
const crypto = require('crypto');
const utime = Math.floor(Date.now() / 1000);
const token = crypto.createHash('md5')
  .update('TransmitSMS your_username your_secret ' + utime)
  .digest('hex');
console.log('Token:', token);
console.log('Utime:', utime);
"

# Test API call with curl
curl -X POST https://sayqal.uz/api/sms/TransmitSMS \
  -H "Content-Type: application/json" \
  -H "X-Access-Token: YOUR_GENERATED_TOKEN" \
  -d '{
    "utime": YOUR_UTIME,
    "username": "your_username",
    "service": { "service": 2 },
    "message": {
      "smsid": "test123",
      "phone": "998901234567",
      "text": "Test code: 1234"
    }
  }'
```

---

## Production Checklist

- [ ] Obtain Sayqal credentials (URL, secret, username)
- [ ] Store credentials in environment variables (never hardcode)
- [ ] Test OTP sending with your phone number
- [ ] Verify OTP expiry behavior (default: 10 minutes)
- [ ] Test rate limiting (cooldown: 2 minutes)
- [ ] Set up SMS report logging for auditing
- [ ] Configure fallback SMS provider (optional but recommended)
- [ ] Add monitoring/alerting for SMS delivery failures
- [ ] Test with international phone numbers if needed
- [ ] Review message templates for compliance
- [ ] Set up delivery status checking (DetalSMS endpoint)
- [ ] Document your integration for team members

---

## Common Issues

### 1. Invalid Token Error

**Cause:** Incorrect token generation formula or mismatched `utime`

**Fix:** Ensure the `utime` in the request body matches the `utime` used in token generation.

```typescript
const utime = Math.floor(Date.now() / 1000);
// Use same utime in both body and token
```

### 2. Phone Number Format

**Cause:** Phone numbers with special characters

**Fix:** Strip all non-digit characters before sending.

```typescript
const cleanPhone = phone.replace(/\D/g, '');
```

### 3. OTP Not Expiring

**Cause:** Missing cleanup for expired OTPs

**Fix:** Add a scheduled job to expire old OTPs.

```typescript
// Run every hour
async expireOldOtps() {
  const expiryDate = dayjs().subtract(10, 'minutes').toDate();
  await this.otpModel.updateMany(
    { status: OtpStatus.UNUSED, createdAt: { $lt: expiryDate } },
    { status: OtpStatus.EXPIRED }
  );
}
```

### 4. Rate Limiting Issues

**Cause:** Too many requests in short time

**Fix:** Implement cooldown period and queue system.

```typescript
// Check cooldown before sending
const recentOtp = await this.otpModel.findOne({
  phone,
  status: OtpStatus.UNUSED,
  createdAt: { $gte: dayjs().subtract(2, 'minutes').toDate() },
});

if (recentOtp) {
  throw new Error('Please wait before requesting a new OTP');
}
```

---

## Quick Start Example

```typescript
import { SayqalSmsService } from './sayqal-sms.service';

// Initialize
const smsService = new SayqalSmsService({
  baseUrl: process.env.SMS_SAYQAL_URL,
  secretKey: process.env.SMS_SAYQAL_SECRET,
  username: process.env.SMS_SAYQAL_USERNAME,
});

// Send OTP
await smsService.sendOtp({
  phone: '998901234567',
  code: 4821,
  signature: 'YourCompany',
});

// Send regular message
await smsService.sendMessage({
  phone: '998901234567',
  message: 'Your order has been shipped!',
});

// Check delivery status
const status = await smsService.checkSmsStatus({
  phone: '998901234567',
});
```

---

## Support

For Sayqal-specific questions:
- Contact your Sayqal account manager
- Review Sayqal API documentation at their portal
- Test credentials in their sandbox environment first

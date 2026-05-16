import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmProvider implements OnModuleInit {
  private readonly logger = new Logger(FcmProvider.name);
  private initialized = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const provider = this.config.get<string>('PUSH_PROVIDER');
    if (provider !== 'fcm') {
      return;
    }

    const serviceAccountJson = this.config.get<string>('FCM_SERVICE_ACCOUNT_JSON');
    if (!serviceAccountJson) {
      this.logger.warn('FCM_SERVICE_ACCOUNT_JSON is not set; push will be disabled');
      return;
    }

    try {
      const credential = admin.credential.cert(JSON.parse(serviceAccountJson));
      admin.initializeApp({ credential });
      this.initialized = true;
      this.logger.log('Firebase Admin SDK initialized');
    } catch (error) {
      this.logger.error(`Failed to initialize Firebase Admin: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  isReady(): boolean {
    return this.initialized;
  }

  getMessaging(): admin.messaging.Messaging {
    return admin.messaging();
  }
}

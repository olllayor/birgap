export interface PushNotificationJobData {
  envelopes: Array<{
    recipientDeviceId: string;
    recipientUserId: string;
  }>;
}

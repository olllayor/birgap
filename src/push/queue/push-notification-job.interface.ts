export interface PushNotificationJobData {
  type: 'new_message' | 'edit' | 'delete';
  envelopes: Array<{
    recipientDeviceId: string;
    recipientUserId: string;
  }>;
}

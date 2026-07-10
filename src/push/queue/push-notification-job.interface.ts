export interface PushNotificationJobData {
  type: 'new_message' | 'edit' | 'delete' | 'incoming_call' | 'missed_call';
  envelopes: Array<{
    recipientDeviceId: string;
    recipientUserId: string;
  }>;
  // Present only for call wakeups: the client needs the call context to ring
  // (incoming_call) or render a missed-call notification (missed_call).
  call?: {
    callId: string;
    callerUserId: string;
    callType: string;
  };
}

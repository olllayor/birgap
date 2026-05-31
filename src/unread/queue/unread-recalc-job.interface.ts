export interface UnreadRecalcJobData {
  userId: string;
  threadId: string;
  threadType: 'direct' | 'group';
  reason: 'new_message' | 'ack_read' | 'recalc';
}

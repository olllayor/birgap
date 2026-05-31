export interface ReactionFanoutJobData {
  reactionId: string;
  messageId: string;
  groupId: string;
  userId: string;
  emoji: string;
  createdAt: string;
  type: 'created' | 'removed';
}

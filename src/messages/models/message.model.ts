import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { MessageMediaType } from './message-media.model';

@ObjectType('Message')
export class MessageType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  threadId!: string | null;

  @Field(() => ID, { nullable: true })
  groupId!: string | null;

  @Field(() => ID)
  senderUserId!: string;

  @Field(() => ID)
  senderDeviceId!: string;

  @Field(() => Int)
  threadSequence!: number;

  @Field(() => ID, { nullable: true })
  replyToMessageId!: string | null;

  @Field(() => MessageType, { nullable: true })
  replyTo?: MessageType | null;

  @Field(() => [MessageMediaType!]!)
  media!: MessageMediaType[];

  @Field()
  createdAt!: Date;

  @Field({ nullable: true })
  deletedAt?: Date | null;

  @Field({ nullable: true })
  editedAt?: Date | null;
}

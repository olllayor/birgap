import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

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

  @Field()
  createdAt!: Date;
}

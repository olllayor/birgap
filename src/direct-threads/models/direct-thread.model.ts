import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { MessageType } from '../../messages/models/message.model';
import { UserType } from '../../users/models/user.model';

@ObjectType('DirectThread')
export class DirectThreadType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  userAId!: string;

  @Field(() => ID)
  userBId!: string;

  @Field(() => Int)
  latestSequence!: number;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field(() => UserType, { nullable: true })
  userA!: UserType | null;

  @Field(() => UserType, { nullable: true })
  userB!: UserType | null;

  @Field(() => [MessageType])
  messages!: MessageType[];
}

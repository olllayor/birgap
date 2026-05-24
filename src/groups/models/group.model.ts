import { Field, ID, ObjectType } from '@nestjs/graphql';
import { MessageType } from '../../messages/models/message.model';
import { GroupMemberType } from './group-member.model';

@ObjectType('Group')
export class GroupType {
  @Field(() => ID)
  id: string;

  @Field(() => [GroupMemberType])
  members: GroupMemberType[];

  @Field(() => [MessageType])
  messages: MessageType[];

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

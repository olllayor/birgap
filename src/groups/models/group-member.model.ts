import { Field, ID, ObjectType } from '@nestjs/graphql';
import { UserType } from '../../users/models/user.model';

@ObjectType('GroupMember')
export class GroupMemberType {
  @Field(() => ID)
  groupId: string;

  @Field(() => ID)
  userId: string;

  @Field()
  role: string;

  @Field()
  joinedAt: Date;

  @Field(() => UserType, { nullable: true })
  user: UserType | null;
}

import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { UserLoader } from '../common/loaders/user.loader';
import { GroupMemberType } from './models/group-member.model';
import { UserType } from '../users/models/user.model';

@Resolver(() => GroupMemberType)
export class GroupMemberResolver {
  constructor(private readonly userLoader: UserLoader) {}

  @ResolveField('user', () => UserType, { nullable: true })
  async user(@Parent() member: GroupMemberType) {
    return this.userLoader.load(member.userId);
  }
}

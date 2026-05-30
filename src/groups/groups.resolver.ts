import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentGqlUser } from '../common/decorators/gql-current-user.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from './groups.service';
import { GroupType } from './models/group.model';
import { MessageType } from '../messages/models/message.model';

@UseGuards(GqlAuthGuard)
@Resolver(() => GroupType)
export class GroupsResolver {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly prisma: PrismaService,
  ) {}

  @Query(() => GroupType, { nullable: true })
  async group(
    @Args('id', { type: () => ID }) id: string,
    @CurrentGqlUser() user: AuthenticatedUser,
  ) {
    await this.groupsService.assertGroupMember(user.userId, id);
    return this.groupsService.findById(id);
  }

  @Query(() => [GroupType])
  async groups(
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentGqlUser() user: AuthenticatedUser,
  ) {
    if (user.userId !== userId) {
      throw new ForbiddenException('Cannot query groups for another user');
    }
    return this.groupsService.findByUser(userId);
  }

  @ResolveField('messages', () => [MessageType])
  async messages(
    @Parent() group: GroupType,
    @Args('limit', { nullable: true, type: () => Int }) limit?: number,
    @Args('beforeSequence', { nullable: true, type: () => Int }) beforeSequence?: number,
    @Args('afterSequence', { nullable: true, type: () => Int }) afterSequence?: number,
  ) {
    const take = Math.min(limit ?? 50, 100);
    const messages = await this.prisma.message.findMany({
      where: {
        groupId: group.id,
        ...(beforeSequence !== undefined && { threadSequence: { lt: beforeSequence } }),
        ...(afterSequence !== undefined && { threadSequence: { gt: afterSequence } }),
      },
      orderBy: { threadSequence: 'desc' },
      take,
    });
    return messages.reverse();
  }
}

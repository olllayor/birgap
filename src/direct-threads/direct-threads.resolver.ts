import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentGqlUser } from '../common/decorators/gql-current-user.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { UserLoader } from '../common/loaders/user.loader';
import { PrismaService } from '../prisma/prisma.service';
import { DirectThreadsService } from './direct-threads.service';
import { DirectThreadType } from './models/direct-thread.model';
import { MessageType } from '../messages/models/message.model';

@UseGuards(GqlAuthGuard)
@Resolver(() => DirectThreadType)
export class DirectThreadsResolver {
  constructor(
    private readonly directThreadsService: DirectThreadsService,
    private readonly userLoader: UserLoader,
    private readonly prisma: PrismaService,
  ) {}

  @Query(() => DirectThreadType, { nullable: true })
  async directThread(
    @Args('id', { type: () => ID }) id: string,
    @CurrentGqlUser() user: AuthenticatedUser,
  ) {
    const thread = await this.directThreadsService.findById(id);
    if (thread.userAId !== user.userId && thread.userBId !== user.userId) {
      throw new ForbiddenException('Cannot query a thread you are not part of');
    }
    return thread;
  }

  @Query(() => [DirectThreadType])
  async directThreads(
    @Args('userId', { type: () => ID }) userId: string,
    @CurrentGqlUser() user: AuthenticatedUser,
  ) {
    if (user.userId !== userId) {
      throw new ForbiddenException('Cannot query threads for another user');
    }
    return this.directThreadsService.findByUser(userId);
  }

  @ResolveField('userA')
  async userA(@Parent() thread: DirectThreadType) {
    return this.userLoader.load(thread.userAId);
  }

  @ResolveField('userB')
  async userB(@Parent() thread: DirectThreadType) {
    return this.userLoader.load(thread.userBId);
  }

  @ResolveField('messages', () => [MessageType])
  async messages(
    @Parent() thread: DirectThreadType,
    @Args('limit', { nullable: true, type: () => Int }) limit?: number,
    @Args('beforeSequence', { nullable: true, type: () => Int }) beforeSequence?: number,
    @Args('afterSequence', { nullable: true, type: () => Int }) afterSequence?: number,
  ) {
    const take = Math.min(limit ?? 50, 100);
    const messages = await this.prisma.message.findMany({
      where: {
        threadId: thread.id,
        ...(beforeSequence !== undefined && { threadSequence: { lt: beforeSequence } }),
        ...(afterSequence !== undefined && { threadSequence: { gt: afterSequence } }),
      },
      orderBy: { threadSequence: 'desc' },
      take,
    });
    return messages.reverse();
  }
}

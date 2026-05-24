import { ForbiddenException, UseGuards } from '@nestjs/common';
import { Args, ID, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentGqlUser } from '../common/decorators/gql-current-user.decorator';
import { AuthenticatedUser } from '../common/types/authenticated-user';
import { UserLoader } from '../common/loaders/user.loader';
import { DirectThreadsService } from './direct-threads.service';
import { DirectThreadType } from './models/direct-thread.model';
import { MessageType } from '../messages/models/message.model';

@UseGuards(GqlAuthGuard)
@Resolver(() => DirectThreadType)
export class DirectThreadsResolver {
  constructor(
    private readonly directThreadsService: DirectThreadsService,
    private readonly userLoader: UserLoader,
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
  messages(@Parent() thread: DirectThreadType) {
    return thread.messages;
  }
}

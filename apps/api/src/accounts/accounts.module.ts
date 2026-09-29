import { Global, Module } from '@nestjs/common';
import { AccountDataService } from './account-data.service.js';
import { AccountsService } from './accounts.service.js';
import { UsersController } from './users.controller.js';

/** Global: the account guard and every controller that filters by owner need the service. */
@Global()
@Module({
  controllers: [UsersController],
  providers: [AccountsService, AccountDataService],
  exports: [AccountsService],
})
export class AccountsModule {}

import { Global, Module } from '@nestjs/common';
import { AccountDataService } from './account-data.service.js';
import { AccountsService } from './accounts.service.js';
import { UsersController } from './users.controller.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AccountUsageService } from './account-usage.service.js';
import { AccountPolicyController } from './account-policy.controller.js';

/** Global: the account guard and every controller that filters by owner need the service. */
@Global()
@Module({
  controllers: [UsersController, AccountPolicyController],
  providers: [AccountsService, AccountDataService, SessionsService, AccountUsageService],
  exports: [AccountsService, SessionsService, AccountUsageService],
})
export class AccountsModule {}

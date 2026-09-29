import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module.js';
import { RunsModule } from '../runs/runs.module.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

@Module({
  imports: [RunsModule, ModelsModule],
  controllers: [ChatsController],
  providers: [ChatsService],
})
export class ChatsModule {}

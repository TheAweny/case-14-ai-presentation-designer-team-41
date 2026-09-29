import { Module } from '@nestjs/common';
import { ChatsController } from './chats.controller.js';

@Module({ controllers: [ChatsController] })
export class ChatsModule {}

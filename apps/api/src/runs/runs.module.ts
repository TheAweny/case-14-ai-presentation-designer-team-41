import { Module } from '@nestjs/common';
import { RunsController } from './runs.controller.js';

@Module({ controllers: [RunsController] })
export class RunsModule {}

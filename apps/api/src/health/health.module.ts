import { Module } from '@nestjs/common';
import { RunsModule } from '../runs/runs.module.js';
import { HealthController } from './health.controller.js';

@Module({ imports: [RunsModule], controllers: [HealthController] })
export class HealthModule {}

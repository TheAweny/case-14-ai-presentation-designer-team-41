import { Module } from '@nestjs/common';
import { RunsModule } from '../runs/runs.module.js';
import { EditorController } from './editor.controller.js';
import { EditorService } from './editor.service.js';

@Module({
  imports: [RunsModule],
  controllers: [EditorController],
  providers: [EditorService],
  exports: [EditorService],
})
export class EditorModule {}

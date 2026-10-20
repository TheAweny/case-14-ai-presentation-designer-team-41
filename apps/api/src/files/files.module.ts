import { Module } from '@nestjs/common';
import { BrandbooksController } from './brandbooks.controller.js';
import { FilesController } from './files.controller.js';

@Module({ controllers: [FilesController, BrandbooksController] })
export class FilesModule {}

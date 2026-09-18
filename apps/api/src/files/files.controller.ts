import { Controller, Get, HttpCode, Post } from '@nestjs/common';

/** Reference to a file stored under the run directory. */
export interface StoredFile {
  readonly fileId: string;
  readonly kind: 'template' | 'content' | 'artifact';
}

/**
 * Uploads of the template `.pptx` and of the content pack, plus downloads of run artifacts.
 * Storage lives in `runs/`; the handlers answer with placeholders for now.
 */
@Controller('files')
export class FilesController {
  @Post('template')
  @HttpCode(202)
  uploadTemplate(): StoredFile {
    return { fileId: 'not-stored', kind: 'template' };
  }

  @Post('content')
  @HttpCode(202)
  uploadContent(): StoredFile {
    return { fileId: 'not-stored', kind: 'content' };
  }

  @Get()
  list(): readonly StoredFile[] {
    return [];
  }
}

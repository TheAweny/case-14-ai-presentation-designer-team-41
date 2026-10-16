import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { z } from 'zod';
import { LocalInputValidationError, type ValidatedLocalInputs } from '@lct/input-validation';
import { jobEventSchema, runConfigSchema } from '@lct/contracts';
import type { JobEvent } from '@lct/contracts';
import type { RunRecord } from '@lct/run-store';
import { RunsService } from './runs.service.js';
import { join, resolve } from 'node:path';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { LibraryMetadata } from '../generation/library-metadata.js';
import { ApiAccountRoutes, ApiErrors, ApiJsonBody } from '../docs/decorators.js';
import { runRecordSchema, validatedInputsSchema } from '../docs/schemas.js';

const RUN_EXAMPLE = {
  runId: 'run-0b6f4c1e-8d2a-4f7b-9c3e-5a1d7e9f2b40',
  state: 'running',
  createdAt: '2026-10-16T10:00:00.000Z',
  updatedAt: '2026-10-16T10:00:04.000Z',
  startedAt: '2026-10-16T10:00:01.000Z',
  completedAt: null,
};

@Controller('runs')
@ApiAccountRoutes('runs')
export class RunsController {
  private readonly library = new LibraryMetadata(
    resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs')),
  );

  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  /**
   * A run of a deck belongs to the account that generated it; another account is told it does
   * not exist. Runs without a deck carry nobody's content and stay readable.
   */
  private async ownedRun(runId: string, account: Account): Promise<RunRecord> {
    const run = await this.runs.get(runId);
    const metadata = await this.library.read(runId).catch(() => null);
    if (run === null || (metadata !== null && metadata.ownerId !== account.id)) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }
    return run;
  }

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Завести пустой прогон', description: 'Прогон в состоянии `queued`.' })
  @ApiAcceptedResponse({
    standardSchema: runRecordSchema,
    example: { ...RUN_EXAMPLE, state: 'queued', startedAt: null },
  })
  create(): Promise<RunRecord> {
    return this.runs.create();
  }

  @Post('validate-inputs')
  @ApiOperation({
    summary: 'Проверить конфиг прогона',
    description:
      'Тот же конфиг, что у `lct generate --config`. Проверяет, что шаблон и материалы на месте и читаются, а каталог результата доступен на запись.',
  })
  @ApiJsonBody(runConfigSchema, {
    'configs/run.example.yaml': {
      templatePath: 'examples/template.pptx',
      contentPath: 'examples/brief.md',
      slideCount: 10,
      layoutVariants: ['dense', 'balanced', 'airy'],
      auditProfile: 'default',
      models: [
        { role: 'planner', modelId: 'planner-default' },
        { role: 'writer', modelId: 'writer-default' },
      ],
      seed: 20260918,
      outputDir: 'runs',
      goal: 'Получить решение правления о масштабировании чат-бота на 8 регионов.',
      audience: 'Правление банка',
      language: 'ru',
    },
  })
  @ApiCreatedResponse({
    standardSchema: validatedInputsSchema,
    example: {
      template: {
        path: '/app/examples/template.pptx',
        sha256: '9f2c4e1a7b3d5f6081c2e4a6b8d0f1e3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5',
        bytes: 2483112,
      },
      content: {
        path: '/app/examples/brief.md',
        sha256: '4a71c3e5f7a9b1d3e5f7a9c1b3d5e7f9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1',
        bytes: 18234,
      },
      outputDir: '/app/runs',
    },
  })
  @ApiErrors(400)
  validateInputs(@Body() body: unknown): ValidatedLocalInputs {
    try {
      const config = runConfigSchema.parse(body);
      return this.runs.validateInputs(config);
    } catch (error) {
      if (error instanceof LocalInputValidationError) {
        throw new BadRequestException({ code: error.code, message: error.message });
      }
      throw new BadRequestException('Run input configuration is invalid.');
    }
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Состояние прогона' })
  @ApiParam({ name: 'runId', example: RUN_EXAMPLE.runId })
  @ApiOkResponse({ standardSchema: runRecordSchema, example: RUN_EXAMPLE })
  @ApiErrors(404)
  status(@Param('runId') runId: string, @CurrentAccount() account: Account): Promise<RunRecord> {
    return this.ownedRun(runId, account);
  }

  @Get(':runId/events')
  @ApiOperation({
    summary: 'События прогона',
    description:
      'Журнал по этапам: начало, прогресс, конец этапа, готовый артефакт, предупреждения. Опрашивается с `after` — номером последнего полученного события.',
  })
  @ApiParam({ name: 'runId', example: RUN_EXAMPLE.runId })
  @ApiQuery({
    name: 'after',
    required: false,
    schema: { type: 'integer', minimum: -1 },
    description: 'Вернуть события с номером больше этого.',
  })
  @ApiOkResponse({
    standardSchema: z.array(jobEventSchema),
    example: [
      {
        schemaVersion: 1,
        runId: RUN_EXAMPLE.runId,
        seq: 0,
        at: '2026-10-16T10:00:01.000Z',
        type: 'stage-started',
        stage: 'planning',
      },
    ],
  })
  @ApiErrors(400, 404)
  async events(
    @Param('runId') runId: string,
    @CurrentAccount() account: Account,
    @Query('after') after?: string,
  ): Promise<readonly JobEvent[]> {
    await this.ownedRun(runId, account);
    const sequence = after === undefined ? -1 : Number(after);
    if (!Number.isInteger(sequence) || sequence < -1) {
      throw new BadRequestException('The after sequence must be an integer >= -1.');
    }
    return this.runs.events(runId, sequence);
  }
}

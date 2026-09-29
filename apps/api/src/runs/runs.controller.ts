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
import { LocalInputValidationError, type ValidatedLocalInputs } from '@lct/input-validation';
import { runConfigSchema } from '@lct/contracts';
import type { JobEvent } from '@lct/contracts';
import type { RunRecord } from '@lct/run-store';
import { RunsService } from './runs.service.js';
import { join, resolve } from 'node:path';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import { LibraryMetadata } from '../generation/library-metadata.js';

@Controller('runs')
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
  create(): Promise<RunRecord> {
    return this.runs.create();
  }

  @Post('validate-inputs')
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
  status(@Param('runId') runId: string, @CurrentAccount() account: Account): Promise<RunRecord> {
    return this.ownedRun(runId, account);
  }

  @Get(':runId/events')
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

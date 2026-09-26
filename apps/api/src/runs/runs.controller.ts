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

@Controller('runs')
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

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
  async status(@Param('runId') runId: string): Promise<RunRecord> {
    const run = await this.runs.get(runId);
    if (run === null) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }
    return run;
  }

  @Get(':runId/events')
  async events(
    @Param('runId') runId: string,
    @Query('after') after?: string,
  ): Promise<readonly JobEvent[]> {
    const run = await this.runs.get(runId);
    if (run === null) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }
    const sequence = after === undefined ? -1 : Number(after);
    if (!Number.isInteger(sequence) || sequence < -1) {
      throw new BadRequestException('The after sequence must be an integer >= -1.');
    }
    return this.runs.events(runId, sequence);
  }
}

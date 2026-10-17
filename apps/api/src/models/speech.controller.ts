import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  Inject,
  Logger,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentAccount } from '../accounts/account.guard.js';
import type { Account } from '../accounts/account-rules.js';
import type { SettingsActor } from './model-settings.service.js';
import { ModelCapabilityService } from './model-capabilities.js';
import { TranscriptionError, transcribeSpeech } from './transcribe.js';

/** Fifteen megabytes: long enough for a prompt, short of the usual transcription limit. */
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

interface UploadedAudio {
  readonly originalname?: string;
  readonly mimetype?: string;
  readonly size: number;
  readonly buffer: Buffer;
}

function actorOf(account: Account): SettingsActor {
  return { userId: account.id, admin: account.role === 'admin' };
}

/**
 * Dictation. The browser sends a recording; the API calls the speech model: the one assigned to
 * `speech`, or a model of the person's connections that a probe showed transcribes. Availability is not probed: a missing model is a
 * settings fact, a failed call is an error of this one recording, and the provider's answer goes
 * back so the person sees why.
 */
@Controller('speech')
export class SpeechController {
  private readonly logger = new Logger(SpeechController.name);

  constructor(
    @Inject(ModelCapabilityService) private readonly capabilities: ModelCapabilityService,
  ) {}

  /**
   * Whether dictation works for this account: a speech model is assigned, or one of its
   * connections has a model that really transcribed a probe recording. The first ask may take a
   * moment while the models are probed; the answer is kept.
   */
  @Get('model')
  async model(@CurrentAccount() account: Account): Promise<{ available: boolean }> {
    const model = await this.capabilities.speechModel(actorOf(account)).catch(() => null);
    return { available: model !== null };
  }

  @Post('transcriptions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AUDIO_BYTES } }))
  async transcribe(
    @UploadedFile() file: UploadedAudio | undefined,
    @CurrentAccount() account: Account,
  ): Promise<{ text: string }> {
    if (!file?.buffer?.length) throw new BadRequestException({ reason: 'empty' });
    const model = await this.capabilities.speechModel(actorOf(account));
    if (!model) throw new ServiceUnavailableException({ reason: 'not-configured' });
    try {
      const text = await transcribeSpeech(model, {
        bytes: file.buffer,
        type: file.mimetype || 'audio/webm',
        name: file.originalname || 'speech.webm',
      });
      return { text };
    } catch (error) {
      const failure =
        error instanceof TranscriptionError ? error : new TranscriptionError(null, String(error));
      this.logger.warn(
        `Speech model ${model.model} on ${model.connectionId} failed: ${failure.message}`,
      );
      throw new BadGatewayException({
        reason: 'transcription-failed',
        status: failure.status,
        detail: failure.detail,
      });
    }
  }
}

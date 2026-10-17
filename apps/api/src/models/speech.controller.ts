import {
  BadGatewayException,
  BadRequestException,
  Controller,
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
import { ModelSettingsService, type SettingsActor } from './model-settings.service.js';
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
 * `speech`, or the provider's own Whisper. Availability is not probed: a missing model is a
 * settings fact, a failed call is an error of this one recording, and the provider's answer goes
 * back so the person sees why.
 */
@Controller('speech')
export class SpeechController {
  private readonly logger = new Logger(SpeechController.name);

  constructor(@Inject(ModelSettingsService) private readonly settings: ModelSettingsService) {}

  @Post('transcriptions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AUDIO_BYTES } }))
  async transcribe(
    @UploadedFile() file: UploadedAudio | undefined,
    @CurrentAccount() account: Account,
  ): Promise<{ text: string }> {
    if (!file?.buffer?.length) throw new BadRequestException({ reason: 'empty' });
    const model = await this.settings.resolveSpeech(actorOf(account));
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

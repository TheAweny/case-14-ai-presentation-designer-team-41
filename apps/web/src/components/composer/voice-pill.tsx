'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useModelSettingsSnapshot } from '@/components/settings/model-settings-store';
import { CloseIcon, DictateIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { transcribeSpeechAction } from '@/app/speech-actions';
import { getSpeechAvailableAction } from '@/app/model-capability-actions';
import { cn } from '@/lib/utils';
import { appendTranscript } from './voice-transcript';

/**
 * The microphone exists only when there is a speech model: an assigned one, or a model of a
 * connection that the API found really transcribes. Asked again whenever the settings change;
 * loading and dictation switched off both hide it.
 */
export function useSpeechConfigured(): boolean {
  const settings = useModelSettingsSnapshot();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!settings) return;
    let current = true;
    getSpeechAvailableAction().then(
      (found) => current && setAvailable(found),
      () => current && setAvailable(false),
    );
    return () => {
      current = false;
    };
  }, [settings]);
  return settings !== null && available;
}

/** Where dictation is: nothing, recording, or waiting for the text of the recording. */
export type DictationPhase = 'idle' | 'listening' | 'transcribing';

/**
 * React Bits Voice Pill, adapted: the mic swells into equalizer bars and a timer while recording,
 * then into a shimmering "transcribing" label until the text arrives.
 * License: docs/third-party/react-bits-license.txt.
 */
export function VoicePill({
  draft,
  onDraft,
  onError,
  onPhase,
  disabled = false,
  compact = false,
}: {
  draft: string;
  onDraft: (next: string) => void;
  /** The error to show under the field, already in words. */
  onError: (message: string) => void;
  /** The composer locks its field and its send button while the recording is turned into text. */
  onPhase?: (phase: DictationPhase) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('composer.voice');
  const [phase, setPhaseState] = useState<DictationPhase>('idle');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const session = useRef(0);
  const starting = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const phaseListener = useRef(onPhase);
  phaseListener.current = onPhase;
  const setPhase = (next: DictationPhase) => {
    setPhaseState(next);
    phaseListener.current?.(next);
  };
  const listening = phase === 'listening';
  const transcribing = phase === 'transcribing';

  useEffect(() => {
    if (!listening || startedAt === null) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [listening, startedAt]);

  useEffect(
    () => () => {
      session.current += 1;
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
      recorder.current = null;
      phaseListener.current?.('idle');
    },
    [],
  );

  const elapsed = listening && startedAt !== null ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  // The moment the person stops, the pill says the text is on its way: the upload and the model
  // take seconds, and a pill that went quiet looked like nothing happened.
  const stop = () => {
    if (!recorder.current || recorder.current.state !== 'recording') return;
    setPhase('transcribing');
    recorder.current.stop();
  };

  const cancel = () => {
    session.current += 1;
    const rec = recorder.current;
    recorder.current = null;
    if (rec) {
      rec.onstop = null;
      if (rec.state !== 'inactive') rec.stop();
      rec.stream.getTracks().forEach((track) => track.stop());
    }
    setStartedAt(null);
    setPhase('idle');
  };

  const start = async () => {
    if (starting.current) return;
    onError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      onError(t('blocked'));
      return;
    }
    starting.current = true;
    const current = ++session.current;
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== session.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audioStream = stream;
      const rec = new MediaRecorder(audioStream);
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (current === session.current && event.data.size > 0) chunks.current.push(event.data);
      };
      rec.onerror = () => {
        if (current !== session.current) return;
        rec.onstop = null;
        audioStream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        setStartedAt(null);
        setPhase('idle');
        onError(t('failed'));
      };
      rec.onstop = () => {
        audioStream.getTracks().forEach((track) => track.stop());
        if (current !== session.current) return;
        recorder.current = null;
        setStartedAt(null);
        setPhase('transcribing');
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        const form = new FormData();
        if (blob.size === 0) {
          onError(t('empty'));
          setPhase('idle');
          return;
        }
        const extension = blob.type.includes('mp4')
          ? 'mp4'
          : blob.type.includes('ogg')
            ? 'ogg'
            : 'webm';
        form.set('audio', blob, `speech.${extension}`);
        void transcribeSpeechAction(form)
          .then((result) => {
            if (current !== session.current) return;
            if (result.ok) onDraft(appendTranscript(draftRef.current, result.text));
            else
              onError(
                result.reason === 'unavailable'
                  ? t('unavailable')
                  : result.detail
                    ? t('failedWith', { detail: result.detail })
                    : t(result.reason === 'empty' ? 'empty' : 'failed'),
              );
          })
          // The action itself failed: the recording did not reach the server.
          .catch(() => {
            if (current === session.current) onError(t('notSent'));
          })
          .finally(() => {
            if (current === session.current) setPhase('idle');
          });
      };
      rec.start();
      recorder.current = rec;
      setStartedAt(Date.now());
      setPhase('listening');
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (current === session.current) onError(t('blocked'));
    } finally {
      starting.current = false;
    }
  };

  return (
    <span className="inline-flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size={compact ? 'icon' : 'icon-lg'}
        disabled={(disabled && phase === 'idle') || transcribing}
        aria-pressed={listening}
        aria-busy={transcribing}
        aria-label={transcribing ? t('transcribing') : listening ? t('stop') : t('start')}
        onClick={() => (listening ? stop() : void start())}
        data-phase={phase}
        className={cn(
          'voice-pill rounded-full text-muted-foreground',
          phase !== 'idle' && 'w-auto gap-1.5 px-2.5 text-foreground',
          // Disabled buttons fade out; this one is busy, not unavailable.
          transcribing && 'disabled:opacity-100',
        )}
      >
        {transcribing ? (
          <>
            <span className="voice-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {compact ? null : (
              <span className="voice-shimmer hidden text-xs sm:inline">
                {t('transcribingShort')}
              </span>
            )}
          </>
        ) : listening ? (
          <>
            <span className="voice-eq" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="text-xs tabular-nums">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </span>
          </>
        ) : (
          <DictateIcon className="size-4" />
        )}
      </Button>
      {phase !== 'idle' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full text-muted-foreground"
          aria-label={t('cancel')}
          onClick={cancel}
        >
          <CloseIcon className="size-4" />
        </Button>
      ) : null}
    </span>
  );
}

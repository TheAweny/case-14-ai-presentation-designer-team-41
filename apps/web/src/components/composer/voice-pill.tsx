'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useModelSettingsSnapshot } from '@/components/settings/model-settings-store';
import { DictateIcon } from '@/components/ui/icons';
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
    if (!recorder.current) return;
    setPhase('transcribing');
    recorder.current.stop();
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError(t('blocked'));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        setStartedAt(null);
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        const form = new FormData();
        form.set('audio', blob, 'speech.webm');
        void transcribeSpeechAction(form)
          .then((result) => {
            if (result.ok) onDraft(appendTranscript(draftRef.current, result.text));
            else
              onError(
                result.detail
                  ? t('failedWith', { detail: result.detail })
                  : t(result.reason === 'empty' ? 'empty' : 'failed'),
              );
          })
          // The action itself failed: the recording did not reach the server.
          .catch(() => onError(t('notSent')))
          .finally(() => setPhase('idle'));
      };
      rec.start();
      recorder.current = rec;
      setStartedAt(Date.now());
      setPhase('listening');
    } catch {
      onError(t('blocked'));
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? 'icon' : 'icon-lg'}
      disabled={disabled || transcribing}
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
          {compact ? null : <span className="voice-shimmer text-xs">{t('transcribingShort')}</span>}
        </>
      ) : listening ? (
        <>
          <span className="voice-eq" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="text-xs tabular-nums">{elapsed}s</span>
        </>
      ) : (
        <DictateIcon className="size-4" />
      )}
    </Button>
  );
}

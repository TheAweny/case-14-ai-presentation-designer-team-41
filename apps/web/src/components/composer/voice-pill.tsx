'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { speechModelOf } from '@lct/contracts';
import { useModelSettingsSnapshot } from '@/components/settings/model-settings-store';
import { DictateIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { transcribeSpeechAction } from '@/app/speech-actions';
import { cn } from '@/lib/utils';
import { appendTranscript } from './voice-transcript';

/**
 * The microphone exists only when there is a speech model: an assigned one, or a Whisper-like
 * model a provider offers. Loading and dictation switched off both hide it.
 */
export function useSpeechConfigured(): boolean {
  const settings = useModelSettingsSnapshot();
  return settings !== null && speechModelOf(settings) !== null;
}

/**
 * React Bits Voice Pill, adapted: the mic swells into equalizer bars and a timer while recording.
 * License: docs/third-party/react-bits-license.txt.
 */
export function VoicePill({
  draft,
  onDraft,
  onError,
  disabled = false,
  compact = false,
}: {
  draft: string;
  onDraft: (next: string) => void;
  /** The error to show under the field, already in words. */
  onError: (message: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('composer.voice');
  const [listening, setListening] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    if (!listening || startedAt === null) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [listening, startedAt]);

  useEffect(
    () => () => {
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
      recorder.current = null;
    },
    [],
  );

  const elapsed = listening && startedAt !== null ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  const stop = () => recorder.current?.stop();

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
        setListening(false);
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
          .catch(() => onError(t('notSent')));
      };
      rec.start();
      recorder.current = rec;
      setStartedAt(Date.now());
      setListening(true);
    } catch {
      onError(t('blocked'));
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? 'icon' : 'icon-lg'}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? t('stop') : t('start')}
      onClick={() => (listening ? stop() : void start())}
      className={cn(
        'rounded-full text-muted-foreground',
        listening && 'w-auto gap-1.5 px-2.5 text-foreground',
      )}
    >
      {listening ? (
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

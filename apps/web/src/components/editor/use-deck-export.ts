'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobEvent } from '@lct/contracts';
import {
  exportProgress,
  plannedStages,
  type DeckExporter,
  type ExportFailure,
  type ExportProgress,
  type ExportRequest,
  type ExportResult,
} from '@/lib/deck-export';

export type ExportPhase = 'idle' | 'running' | 'done' | 'failed';

export interface DeckExportJob {
  readonly phase: ExportPhase;
  readonly request: ExportRequest | null;
  readonly progress: ExportProgress | null;
  readonly result: ExportResult | null;
  readonly failure: ExportFailure | null;
  start(request: ExportRequest): void;
  /** Показать сбой, не начиная сборку файла. Так экспорт сообщает, что редакция не записана. */
  fail(message: string): void;
  cancel(): void;
  /** Вернуться к выбору параметров. Идущий экспорт отменяется. */
  reset(): void;
}

/** Сбой без события `failed`: обрыв сети, ошибка клиента. Его всегда можно повторить. */
const UNKNOWN_FAILURE: ExportFailure = { code: 'internal', message: '', retryable: true };

/**
 * Экспорт живёт в редакторе, а не в диалоге: окно можно свернуть, и работа продолжится, а
 * кнопка «Экспорт» покажет, сколько осталось.
 */
export function useDeckExport(exporter: DeckExporter | undefined): DeckExportJob {
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [request, setRequest] = useState<ExportRequest | null>(null);
  const [events, setEvents] = useState<readonly JobEvent[]>([]);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<ExportFailure | null>(null);
  const running = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    running.current?.abort();
    running.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(
    (next: ExportRequest) => {
      if (!exporter) return;
      stop();
      const controller = new AbortController();
      running.current = controller;
      setRequest(next);
      setEvents([]);
      setResult(null);
      setError(null);
      setPhase('running');
      exporter
        .export(
          next,
          (event) => {
            if (running.current === controller) setEvents((current) => [...current, event]);
          },
          controller.signal,
        )
        .then((done) => {
          if (running.current !== controller) return;
          running.current = null;
          setResult(done);
          setPhase('done');
          if (done.url) download(done.url, done.fileName);
        })
        .catch((reason: unknown) => {
          if (running.current !== controller) return;
          running.current = null;
          if (reason instanceof DOMException && reason.name === 'AbortError') {
            setPhase('idle');
            return;
          }
          setError(
            reason instanceof Error && reason.message
              ? { code: 'internal', message: reason.message, retryable: true }
              : UNKNOWN_FAILURE,
          );
          setPhase('failed');
        });
    },
    [exporter, stop],
  );

  const fail = useCallback(
    (message: string) => {
      stop();
      setRequest(null);
      setEvents([]);
      setResult(null);
      setError({ code: 'internal', message, retryable: true });
      setPhase('failed');
    },
    [stop],
  );

  const cancel = useCallback(() => {
    stop();
    setPhase('idle');
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    setPhase('idle');
    setRequest(null);
    setEvents([]);
    setResult(null);
    setError(null);
  }, [stop]);

  const progress = useMemo(
    () => (request ? exportProgress(plannedStages(), events) : null),
    [request, events],
  );
  // Сервер сообщил причину — она важнее общей ошибки клиента.
  const failure = progress?.failure ?? error;

  return {
    phase: phase === 'running' && progress?.failure ? 'failed' : phase,
    request,
    progress,
    result,
    failure: phase === 'idle' ? null : failure,
    start,
    fail,
    cancel,
    reset,
  };
}

/** Скачать готовый файл сразу, как Figma: человек уже нажал «Скачать» и ждал именно этого. */
function download(url: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

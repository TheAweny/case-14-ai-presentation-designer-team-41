'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiFetch } from '@/lib/api';

/** Как часто спрашивать, нарисованы ли слайды, и сколько ждать. Рисуется шаблон около минуты. */
const DRAWN_POLL_MS = 10_000;
const DRAWN_WAIT_MS = 4 * 60_000;

/**
 * Разбор шаблона для галереи слайдов. `index` — шаблон ещё не разобран: запускает подготовку
 * (профиль и заметки индексатора) и обновляет страницу, когда она закончится. `draw` — разобран,
 * но слайды ещё не нарисованы: подготовка их дорисует, а страница обновляется, пока картинки не
 * появятся. Подготовка та же, что перед генерацией, поэтому генерация на этом шаблоне потом не
 * ждёт разбора.
 */
export function TemplateSamplesWatcher({
  templateId,
  mode,
}: {
  templateId: string;
  mode: 'index' | 'draw';
}) {
  const t = useTranslations('projectPage.template');
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void apiFetch('/generation/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId, model: null }),
    })
      .then((response) => {
        if (stopped) return;
        if (!response.ok) {
          setFailed(true);
          return;
        }
        router.refresh();
        if (mode !== 'draw') return;
        const started = Date.now();
        timer = setInterval(() => {
          if (Date.now() - started > DRAWN_WAIT_MS) clearInterval(timer);
          else router.refresh();
        }, DRAWN_POLL_MS);
      })
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [templateId, mode, router]);

  const text = failed ? t('prepareFailed') : mode === 'index' ? t('pending') : t('drawing');
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {text}
    </p>
  );
}

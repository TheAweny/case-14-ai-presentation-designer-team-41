'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import type { QrCodePart } from '@lct/contracts';
import { Button } from '@/components/ui/button';
import { useAssistantDeck } from './deck-context';
import { qrInsertFailure, qrPngBytes } from '@/components/editor/qr-insert';

/** The QR is an ordinary image; only an explicit click writes it to the deck journal. */
export function QrCodeCard({ part }: { part: QrCodePart }) {
  const t = useTranslations('qrCode');
  const bridge = useAssistantDeck();
  const [result, setResult] = useState<'inserted' | 'cannot-fit' | 'no-slide' | null>(null);
  const invalid = qrInsertFailure(part) !== null;
  const insert = () => {
    const bytes = qrPngBytes(part.pngDataUrl);
    if (invalid || !bytes || !bridge?.insertImage) return;
    const file = new File([new Uint8Array(bytes)], `qr-${part.qrId}.png`, { type: 'image/png' });
    setResult(bridge.insertImage({ file, minimumSizeEmu: part.minSizeEmu }));
  };
  return (
    <div
      data-qr-code={part.qrId}
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-3 py-2 text-[0.8125rem]"
    >
      <p className="font-medium">{t('title')}</p>
      {!invalid ? (
        <Image
          unoptimized
          src={part.pngDataUrl}
          alt={t('preview')}
          width={part.width}
          height={part.height}
          className="h-auto w-40 max-w-full self-start bg-white [image-rendering:pixelated]"
        />
      ) : null}
      <p className="min-w-0 whitespace-pre-wrap wrap-anywhere" dir="auto">
        {invalid ? (
          part.url
        ) : (
          <a
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {part.url}
          </a>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(part.reachability.status === 'fetched' ? 'fetched' : 'notChecked')}
      </p>
      <div className="flex flex-wrap gap-2">
        {!invalid ? (
          <Button asChild size="sm" variant="outline">
            <a href={part.pngDataUrl} download={`qr-${part.qrId}.png`}>
              {t('download')}
            </a>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={insert}
          disabled={invalid || !bridge?.insertImage}
        >
          {t('insert')}
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {invalid
          ? t('invalid')
          : result
            ? t(result)
            : !bridge?.insertImage
              ? t('openEditor')
              : t('sizeHint')}
      </p>
    </div>
  );
}

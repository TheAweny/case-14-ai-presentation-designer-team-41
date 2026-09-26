'use client';

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Зона, куда можно перетащить файлы, и кнопка выбора — для клавиатуры и телефона, где
 * перетаскивать нечем. Проверку типа делает хозяин зоны: `accept` у поля выбора только
 * подсказка системному диалогу, а перетащить можно что угодно.
 */
export function FileDrop({
  accept,
  multiple = false,
  icon,
  title,
  chooseLabel,
  hint,
  describedBy,
  onFiles,
  className,
}: {
  accept: string;
  multiple?: boolean;
  icon: IconSvgElement;
  title: ReactNode;
  chooseLabel: string;
  hint?: ReactNode;
  /** Id текста ошибки или подсказки, который читает экранный диктор вместе с кнопкой. */
  describedBy?: string;
  onFiles: (files: readonly File[]) => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setOver(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      onDragEnter={(event) => {
        if (hasFiles(event)) setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(event) => {
        // Переход на дочерний элемент — ещё не уход из зоны.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={drop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center',
        'transition-colors duration-100 motion-reduce:transition-none',
        over ? 'border-foreground/60 bg-muted' : 'border-border bg-muted/30',
        className,
      )}
    >
      <HugeiconsIcon
        icon={icon}
        size={22}
        strokeWidth={1.5}
        className="text-muted-foreground"
        aria-hidden
      />
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm text-foreground">
        {title}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-describedby={describedBy}
          onClick={() => input.current?.click()}
        >
          {chooseLabel}
        </Button>
      </div>
      {hint ? <p className="text-xs text-balance text-muted-foreground">{hint}</p> : null}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          // Сбрасываем, чтобы тот же файл можно было выбрать снова после удаления.
          event.currentTarget.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
    </div>
  );
}

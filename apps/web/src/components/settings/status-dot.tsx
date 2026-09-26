import { cn } from '@/lib/utils';

/**
 * Точка состояния. Своих цветов «успех» и «внимание» в теме нет — берём зелёный и жёлтый из
 * палитры проектов: они подобраны под обе темы.
 */
export function StatusDot({ tone }: { tone: 'ok' | 'error' | 'warning' | 'idle' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        tone === 'ok' && 'bg-(--project-green)',
        tone === 'error' && 'bg-destructive',
        tone === 'warning' && 'bg-(--project-yellow)',
        tone === 'idle' && 'bg-muted-foreground/50',
      )}
    />
  );
}

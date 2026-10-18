'use client';

import { useTranslations } from 'next-intl';
import type { ModelKind } from '@lct/contracts';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDownIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

/** What a person can mark a model as. A model that draws and also chats is described by its provider. */
const PRESETS = {
  text: ['text'],
  vlm: ['text', 'vision'],
  image: ['image'],
  speech: ['speech'],
  none: [],
} as const satisfies Record<string, readonly ModelKind[]>;
type Preset = keyof typeof PRESETS;

function presetOf(kinds: readonly ModelKind[]): Preset | null {
  const key = [...kinds].sort().join(' ');
  const found = (Object.keys(PRESETS) as Preset[]).find(
    (preset) => [...PRESETS[preset]].sort().join(' ') === key,
  );
  return found ?? null;
}

/**
 * What a model of a connection is, and a menu to correct it. It shows what the provider said, or
 * that it said nothing and the model is taken for a chat model; a choice made here wins over both
 * and applies to everyone using the connection.
 */
export function ModelKindMenu({
  modelId,
  kinds,
  source,
  editable,
  disabled,
  onChange,
}: {
  modelId: string;
  kinds: readonly ModelKind[];
  source: 'manual' | 'provider' | 'assumed';
  editable: boolean;
  disabled: boolean;
  /** Null goes back to the provider's description. */
  onChange: (kinds: ModelKind[] | null) => void;
}) {
  const t = useTranslations('settings.models.connections.models.kinds');
  const preset = presetOf(kinds);
  const label = preset ? t(preset) : kinds.map((kind) => t(`kind.${kind}`)).join(', ');
  const hint = t(`source.${source}`);
  const chip = cn(
    'h-6 shrink-0 gap-1 rounded-full px-2 text-[0.6875rem] font-normal',
    source === 'manual' ? 'bg-muted text-foreground' : 'text-muted-foreground',
    source === 'assumed' && 'italic',
  );
  if (!editable) {
    return (
      <span className={cn(chip, 'inline-flex items-center')} title={hint}>
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={chip}
          title={hint}
          aria-label={t('label', { model: modelId, kind: label })}
        >
          {label}
          <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">{hint}</p>
        <DropdownMenuRadioGroup
          value={preset ?? ''}
          onValueChange={(value) => onChange([...PRESETS[value as Preset]])}
        >
          {(Object.keys(PRESETS) as Preset[]).map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {source === 'manual' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>{t('reset')}</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

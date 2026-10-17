'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { CHAT_MODES, type ChatMode } from '@lct/contracts';
import { PROMPT_CHIP } from '@/components/composer/prompt-box';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDownIcon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'lct.chatMode';
const listeners = new Set<() => void>();

function storedMode(): ChatMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return CHAT_MODES.find((mode) => mode === value) ?? 'plan';
  } catch {
    return 'plan';
  }
}

/** Режим, с которым начинается новый чат: последний выбранный, сначала — «План». */
export function useLastChatMode(): [ChatMode, (mode: ChatMode) => void] {
  const mode = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    storedMode,
    () => 'plan' as const,
  );
  const set = (next: ChatMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Без хранилища режим просто не запомнится.
    }
    for (const listener of listeners) listener();
  };
  return [mode, set];
}

/** Следующий режим по кругу — для Shift+Tab в поле, как в Claude Code. */
export function nextChatMode(mode: ChatMode): ChatMode {
  return CHAT_MODES[(CHAT_MODES.indexOf(mode) + 1) % CHAT_MODES.length] ?? 'plan';
}

/**
 * Режим агента у поля ввода: «Чат» только разговаривает, «План» сначала показывает план и ждёт
 * одобрения, «Авто» собирает сразу. Режим действует на следующее сообщение.
 */
export function ModeMenu({
  value,
  onChange,
  compact = false,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
  compact?: boolean;
}) {
  const t = useTranslations('deckChat.modes');
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'sm' : 'lg'}
          className={cn(PROMPT_CHIP, 'gap-1.5')}
          aria-label={`${t('label')}: ${t(`${value}.name`)}`}
          title={t(`${value}.description`)}
        >
          <span className="truncate">{t(`${value}.name`)}</span>
          <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" glow>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            const mode = CHAT_MODES.find((item) => item === next);
            if (mode) onChange(mode);
          }}
        >
          {CHAT_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {t(`${mode}.name`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

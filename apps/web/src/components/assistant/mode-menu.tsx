'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatMode } from '@lct/contracts';
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
import { Switch } from '@/components/ui/switch';
import {
  CHAT_UI_MODES,
  chatUiMode,
  rememberChatMode,
  selectChatMode,
  storedChatMode,
  subscribeChatMode,
} from '@/lib/chat-modes';
import { cn } from '@/lib/utils';

/** Режим, с которым начинается новый чат: последний выбранный, сначала — «План». */
export function useLastChatMode(): [ChatMode, (mode: ChatMode) => void] {
  const mode = useSyncExternalStore(subscribeChatMode, storedChatMode, () => 'plan' as const);
  return [mode, rememberChatMode];
}

/**
 * Два режима у поля ввода. В «Плане» переключатель «Авто» управляет утверждением плана.
 * Режим действует на следующее сообщение; API по-прежнему получает chat, plan или auto.
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
  const mode = chatUiMode(value);
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={compact ? 'sm' : 'lg'}
            className={cn(PROMPT_CHIP, 'gap-1.5')}
            aria-label={`${t('label')}: ${t(`${mode}.name`)}`}
            title={t(`${value}.description`)}
          >
            <span className="truncate">{t(`${mode}.name`)}</span>
            <ChevronDownIcon data-icon="inline-end" className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" glow>
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(next) => {
              const mode = CHAT_UI_MODES.find((item) => item === next);
              if (mode) onChange(selectChatMode(mode, value));
            }}
          >
            {CHAT_UI_MODES.map((mode) => (
              <DropdownMenuRadioItem key={mode} value={mode}>
                {t(`${mode}.name`)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === 'plan' ? (
        <label
          className={cn(
            PROMPT_CHIP,
            'inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 text-xs/relaxed select-none',
            compact && 'h-6',
          )}
          title={t(value === 'auto' ? 'auto.description' : 'plan.description')}
        >
          <span>{t('auto.name')}</span>
          <Switch
            aria-label={t('auto.name')}
            aria-description={t(value === 'auto' ? 'auto.description' : 'plan.description')}
            checked={value === 'auto'}
            onCheckedChange={(checked) => onChange(checked ? 'auto' : 'plan')}
          />
        </label>
      ) : null}
    </>
  );
}

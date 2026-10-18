'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ThinkingIcon } from '@/components/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWriterModels } from '@/components/settings/model-settings-store';
import type { ModelRef } from '@/lib/model-settings';
import { readThinking, subscribeThinking, writeThinking } from '@/lib/reasoning-effort';
import { effectiveModel } from '@/lib/writer-models';
import { cn } from '@/lib/utils';
import { useModelCapabilities } from './use-model-capabilities';
import { PROMPT_CHIP } from './prompt-box';

/**
 * Whether the model thinks while it builds a deck. The chat always thinks where it can; this
 * chip is for the build only. Only a model that probing showed answers both ways gets it: the
 * others either always think or never do, and a switch there would lie.
 */
export function ThinkingToggle({
  model,
  compact = false,
}: {
  /** The model of the chat; null — the default one. */
  model: ModelRef | null;
  compact?: boolean;
}) {
  const t = useTranslations('composer.model');
  const models = useWriterModels('assistant');
  const on = useSyncExternalStore(subscribeThinking, readThinking, () => false);
  const selected = models ? effectiveModel(models, model) : null;
  const capabilities = useModelCapabilities(selected);
  if (!capabilities?.reasoning.toggle) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'lg'}
          aria-pressed={on}
          aria-label={compact ? t('thinking') : undefined}
          onClick={() => writeThinking(!on)}
          className={cn(PROMPT_CHIP, 'thinking-toggle', compact && 'px-0')}
        >
          <ThinkingIcon className="thinking-glyph" />
          {compact ? null : <span>{t('thinking')}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{on ? t('thinkingOn') : t('thinkingOff')}</TooltipContent>
    </Tooltip>
  );
}

'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { PanelRightCloseIcon } from '@hugeicons/core-free-icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { keepCanvasFocus } from '@/components/editor/chrome-focus';
import { DesignPanel, type DesignPanelProps } from '@/components/editor/inspector/design-panel';
import { LayersPanel, type LayersPanelProps } from '@/components/editor/inspector/layers-panel';
import { AuditPanel, type AuditPanelProps } from '@/components/editor/audit/audit-panel';
import { countIssues } from '@/components/editor/audit/deck-audit';

export type InspectorTab = 'design' | 'layers' | 'audit' | 'assistant';

export const INSPECTOR_TABS = [
  'design',
  'layers',
  'audit',
  'assistant',
] as const satisfies readonly InspectorTab[];

function isTab(value: string): value is InspectorTab {
  return (INSPECTOR_TABS as readonly string[]).includes(value);
}

/**
 * Правая панель редактора: свойства выделения, слои слайда, проверка колоды и ассистент. Вкладки, а не
 * несколько панелей, — место справа одно, и человек сам решает, что там сейчас нужнее.
 */
export function InspectorPanel({
  tab,
  onTabChange,
  onCollapse,
  design,
  layers,
  audit,
  assistant,
}: {
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onCollapse: () => void;
  design: DesignPanelProps;
  layers?: LayersPanelProps;
  /** Находки живого аудита колоды. */
  audit?: AuditPanelProps;
  /** Разговор с ассистентом о колоде. */
  assistant: ReactNode;
}) {
  const t = useTranslations('editor');
  const auditText = useTranslations('auditPanel');
  const errors = audit ? countIssues(audit.issues).errors : 0;

  return (
    <TooltipProvider>
      <aside aria-label={t('inspector')} className="flex h-full min-w-0 flex-col bg-sidebar">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isTab(value)) onTabChange(value);
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-2">
            <TabsList>
              <TabsTrigger value="design">{t('tabs.design')}</TabsTrigger>
              {layers ? <TabsTrigger value="layers">{t('tabs.layers')}</TabsTrigger> : null}
              {audit ? (
                <TabsTrigger value="audit" className="gap-1">
                  {auditText('tab')}
                  {errors > 0 ? (
                    <>
                      <span
                        aria-hidden
                        className="grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-none font-medium text-white tabular-nums"
                      >
                        {errors}
                      </span>
                      <span className="sr-only">{auditText('errors', { count: errors })}</span>
                    </>
                  ) : null}
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="assistant">{t('tabs.assistant')}</TabsTrigger>
            </TabsList>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('inspectorHide')}
                  onMouseDown={keepCanvasFocus}
                  onClick={onCollapse}
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none',
                    'transition-colors duration-100 motion-reduce:transition-none',
                    'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
                  )}
                >
                  <HugeiconsIcon
                    icon={PanelRightCloseIcon}
                    size={16}
                    strokeWidth={1.5}
                    color="currentColor"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('inspectorHide')}</TooltipContent>
            </Tooltip>
          </div>

          <TabsContent value="design" className="min-h-0 overflow-y-auto">
            <DesignPanel {...design} />
          </TabsContent>
          {layers ? (
            <TabsContent value="layers" className="min-h-0 overflow-y-auto">
              <LayersPanel {...layers} />
            </TabsContent>
          ) : null}
          {audit ? (
            <TabsContent value="audit" className="min-h-0 overflow-y-auto">
              <AuditPanel {...audit} />
            </TabsContent>
          ) : null}
          <TabsContent value="assistant" className="flex min-h-0 flex-col">
            {assistant}
          </TabsContent>
        </Tabs>
      </aside>
    </TooltipProvider>
  );
}

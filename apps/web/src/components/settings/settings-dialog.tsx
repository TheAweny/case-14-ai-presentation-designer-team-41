'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AiBrain01Icon,
  KeyboardIcon,
  PenTool03Icon,
  Presentation01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SETTINGS_PARAM,
  SETTINGS_SECTIONS,
  settingsSection,
  type SettingsSection,
} from '@/lib/settings-url';
import { NARROW_SCREEN, useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { DeckSettingsPanel } from './deck-settings-panel';
import { EditorSettingsPanel } from './editor-settings-panel';
import { ModelSettingsPanel } from './model-settings-panel';
import { ShortcutSettingsPanel } from './shortcut-settings-panel';
import { closeSettings, openSettings } from './open-settings';
import { OWN_ESCAPE_ATTRIBUTE } from './role-row';

const SECTION_ICONS: Readonly<Record<SettingsSection, IconSvgElement>> = {
  general: Settings01Icon,
  editor: PenTool03Icon,
  shortcuts: KeyboardIcon,
  decks: Presentation01Icon,
  models: AiBrain01Icon,
};

/**
 * Окно настроек на любой странице: открыто, пока в адресе есть `?settings=`. Живёт в корневом
 * макете, поэтому одно и то же окно открывается из сайдбара главного меню, из меню файла
 * редактора и по Ctrl+,.
 */
export function SettingsHost() {
  const params = useSearchParams();
  const section = settingsSection(params.get(SETTINGS_PARAM));
  // Пока окно закрывается, в нём остаётся последний раздел, а не пустота.
  const [shown, setShown] = useState<SettingsSection>(section ?? 'general');
  if (section !== null && section !== shown) setShown(section);

  return (
    <Dialog
      open={section !== null}
      onOpenChange={(open) => {
        if (!open) closeSettings();
      }}
    >
      <SettingsDialogContent section={section ?? shown} />
    </Dialog>
  );
}

/**
 * Разделы слева, содержимое справа — как в настройках Claude. На узком экране разделы уходят
 * наверх строкой вкладок. Раздел пишется в адрес: ссылка открывает ровно его.
 */
function SettingsDialogContent({ section }: { section: SettingsSection }) {
  const t = useTranslations('settings');
  const narrow = useMediaQuery(NARROW_SCREEN);

  return (
    <DialogContent
      closeLabel={t('close')}
      className="flex h-[min(42rem,calc(100dvh-2rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0"
      onEscapeKeyDown={(event) => {
        // Поле, которое Esc отменяет само (id модели вручную), окно не закрывает.
        const focused = document.activeElement;
        if (focused instanceof Element && focused.closest(`[${OWN_ESCAPE_ATTRIBUTE}]`)) {
          event.preventDefault();
        }
      }}
    >
      <Tabs
        value={section}
        onValueChange={(next) => openSettings(settingsSection(next) ?? 'general')}
        orientation={narrow ? 'horizontal' : 'vertical'}
        className="min-h-0 flex-1 gap-0"
      >
        <div
          className={cn(
            'flex shrink-0 flex-col gap-3 border-border px-3 pt-3 pb-2',
            'max-md:border-b md:w-52 md:border-r md:bg-sidebar md:pb-3',
          )}
        >
          <div className="grid gap-0.5 px-2 pt-1 pr-10 md:pr-2">
            <DialogTitle className="text-base">{t('title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('description')}</DialogDescription>
          </div>
          <TabsList
            aria-label={t('sections.label')}
            className="h-auto w-full justify-start bg-transparent p-0 md:flex-col md:items-stretch"
          >
            {SETTINGS_SECTIONS.map((id) => (
              <TabsTrigger
                key={id}
                value={id}
                className={cn(
                  'h-8 justify-start gap-2 px-2 text-sm font-normal text-muted-foreground',
                  'hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none',
                )}
              >
                <HugeiconsIcon icon={SECTION_ICONS[id]} size={16} strokeWidth={1.5} />
                {t(`sections.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="general" className="min-h-0 overflow-y-auto">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="editor" className="min-h-0 overflow-y-auto">
          <EditorSettingsPanel />
        </TabsContent>
        <TabsContent value="shortcuts" className="min-h-0 overflow-y-auto">
          <ShortcutSettingsPanel />
        </TabsContent>
        <TabsContent value="decks" className="min-h-0 overflow-y-auto">
          <DeckSettingsPanel />
        </TabsContent>
        <TabsContent value="models" className="min-h-0 overflow-y-auto">
          <ModelSettingsPanel />
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

/** «Общие»: язык интерфейса. */
function GeneralSettings() {
  const t = useTranslations('settings');
  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <h2 className="text-base font-semibold md:pr-8">{t('general.title')}</h2>
      <div className="flex min-h-10 items-center justify-between gap-4 border-b border-border pb-4">
        <span className="text-sm">{t('general.language')}</span>
        <LocaleSwitcher />
      </div>
    </div>
  );
}

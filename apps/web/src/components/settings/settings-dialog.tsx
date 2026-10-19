'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  DeckIcon,
  EditorIcon,
  KeyboardIcon,
  ModelsIcon,
  SettingsIcon,
  UserIcon,
  type Icon,
} from '@/components/ui/icons';
import { useAccount } from '@/components/auth/account-context';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ADMIN_HREF } from '@/lib/library-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SETTINGS_PARAM,
  SETTINGS_SECTIONS,
  settingsSection,
  type SettingsSection,
} from '@/lib/settings-url';
import { cn } from '@/lib/utils';
import { AccountSettingsPanel } from './account-settings-panel';
import { DeckSettingsPanel } from './deck-settings-panel';
import { EditorSettingsPanel } from './editor-settings-panel';
import { ModelSettingsPanel } from './model-settings-panel';
import { ShortcutSettingsPanel } from './shortcut-settings-panel';
import { closeSettings, openSettings } from './open-settings';
import { OWN_ESCAPE_ATTRIBUTE } from './role-row';

const SECTION_ICONS: Readonly<Record<SettingsSection, Icon>> = {
  account: UserIcon,
  general: SettingsIcon,
  editor: EditorIcon,
  shortcuts: KeyboardIcon,
  decks: DeckIcon,
  models: ModelsIcon,
};

/**
 * Окно настроек на любой странице: открыто, пока в адресе есть `?settings=`. Живёт в корневом
 * макете, поэтому одно и то же окно открывается из сайдбара главного меню, из меню файла
 * редактора и по Ctrl+,.
 */
export function SettingsHost() {
  const params = useSearchParams();
  const router = useRouter();
  const account = useAccount();
  const raw = params.get(SETTINGS_PARAM);
  // Раньше люди жили в настройках. Старая ссылка открывает панель администратора.
  const legacyAdmin = raw === 'users' && account?.role === 'admin';
  useEffect(() => {
    if (legacyAdmin) router.replace(ADMIN_HREF);
  }, [legacyAdmin, router]);
  const section = legacyAdmin ? null : settingsSection(raw);
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
 * наверх компактным списком. Раздел пишется в адрес: ссылка открывает ровно его.
 */
function SettingsDialogContent({ section }: { section: SettingsSection }) {
  const t = useTranslations('settings');
  const sectionSelectId = useId();
  // Без аккаунта (страница входа) раздела «Аккаунт» нет.
  const account = useAccount();
  const sections = SETTINGS_SECTIONS.filter((id) => id !== 'account' || account !== null);

  return (
    <DialogContent
      closeLabel={t('close')}
      className={cn(
        'flex h-[min(46rem,calc(100dvh-2rem))] max-w-5xl flex-col gap-0 overflow-hidden p-0',
        'max-md:[&>[data-slot=dialog-close]]:top-1 max-md:[&>[data-slot=dialog-close]]:right-1 max-md:[&>[data-slot=dialog-close]]:size-11',
        'max-md:[&_input:not([type=radio]):not([type=checkbox])]:min-h-11 max-md:[&_input:not([type=radio]):not([type=checkbox])]:text-base',
        'max-md:[&_textarea]:text-base',
      )}
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
        orientation="vertical"
        className="min-h-0 min-w-0 flex-1 gap-0 data-[orientation=vertical]:flex-col md:data-[orientation=vertical]:flex-row"
      >
        <div
          className={cn(
            'flex min-w-0 shrink-0 flex-col gap-3 border-border px-3 pt-3 pb-3',
            'max-md:border-b md:w-52 md:border-r md:bg-sidebar',
          )}
        >
          <div className="grid gap-0.5 px-2 pt-1 pr-10 md:pr-2">
            <DialogTitle className="text-base">{t('title')}</DialogTitle>
            <DialogDescription className="sr-only">{t('description')}</DialogDescription>
          </div>
          <label htmlFor={sectionSelectId} className="sr-only md:hidden">
            {t('sections.label')}
          </label>
          <select
            id={sectionSelectId}
            value={section}
            onChange={(event) =>
              openSettings(settingsSection(event.currentTarget.value) ?? 'general')
            }
            className="h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:hidden"
          >
            {sections.map((id) => (
              <option key={id} value={id}>
                {t(`sections.${id}`)}
              </option>
            ))}
          </select>
          <TabsList
            aria-label={t('sections.label')}
            className="hidden h-auto w-full justify-start bg-transparent p-0 md:flex md:flex-col md:items-stretch"
          >
            {sections.map((id) => {
              const SectionIcon = SECTION_ICONS[id];
              return (
                <TabsTrigger
                  key={id}
                  value={id}
                  className={cn(
                    'h-8 justify-start gap-2 px-2 text-sm font-normal text-muted-foreground',
                    'hover:bg-muted data-[state=active]:bg-muted data-[state=active]:shadow-none',
                  )}
                >
                  <SectionIcon size={16} />
                  {t(`sections.${id}`)}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {account ? (
          <TabsContent
            value="account"
            className="min-h-0 min-w-0 overflow-y-auto overscroll-contain"
          >
            <AccountSettingsPanel account={account} />
          </TabsContent>
        ) : null}
        <TabsContent value="general" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <GeneralSettings />
        </TabsContent>
        <TabsContent value="editor" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <EditorSettingsPanel />
        </TabsContent>
        <TabsContent
          value="shortcuts"
          className="min-h-0 min-w-0 overflow-y-auto overscroll-contain"
        >
          <ShortcutSettingsPanel />
        </TabsContent>
        <TabsContent value="decks" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          <DeckSettingsPanel />
        </TabsContent>
        <TabsContent value="models" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
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

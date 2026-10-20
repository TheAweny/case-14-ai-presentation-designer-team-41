import { HomeLayout } from 'fumadocs-ui/layouts/home';
import Link from 'next/link';
import { baseOptions } from '@/lib/layout.shared';

const entries = [
  {
    href: '/docs/getting-started',
    title: 'Создать презентацию',
    text: 'Что делает сервис, из каких частей состоит колода и с какого шага начать.',
  },
  {
    href: '/docs/operations',
    title: 'Развернуть сервис',
    text: 'Что нужно для установки, как устроен Docker-стек и куда смотреть, если он не поднялся.',
  },
  {
    href: '/docs/developers',
    title: 'Разрабатывать и интегрировать',
    text: 'Локальное окружение, границы слоёв и API. Справочник маршрутов лежит рядом.',
  },
] as const;

const sections = [
  ['Начало работы', '/docs/getting-started', 'Назначение и основные понятия.'],
  ['Руководство пользователя', '/docs/guide', 'Проекты, ассистент, сборка, редактор, настройки.'],
  ['Установка и эксплуатация', '/docs/operations', 'Требования, модели, аккаунты, диагностика.'],
  ['CLI', '/docs/cli', 'Команды lct, флаги и конфиг прогона.'],
  ['Как это работает', '/docs/internals', 'Пайплайн, слои и инварианты.'],
  ['Разработчикам', '/docs/developers', 'Окружение, контракты, агенты, тесты.'],
  ['API', '/docs/api', 'Доступ, ошибки и сгенерированный справочник.'],
  ['Решение проблем', '/docs/troubleshooting', 'Симптом, проверка, действие.'],
] as const;

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <main id="content" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
        <p className="text-sm text-fd-muted-foreground">Цифровой дизайнер презентаций</p>
        <h1 className="docs-title mt-2 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Документация
        </h1>
        <p className="mt-4 max-w-2xl text-base text-fd-muted-foreground sm:text-lg">
          Выберите, что нужно сделать сейчас.
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-3">
          {entries.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className="flex h-full flex-col rounded-xl border border-fd-border bg-fd-card px-4 py-4 transition-colors hover:border-fd-primary/50"
              >
                <span className="text-base font-medium">{entry.title}</span>
                <span className="mt-2 text-sm text-fd-muted-foreground">{entry.text}</span>
              </Link>
            </li>
          ))}
        </ul>
        <h2 className="mt-12 text-lg font-medium">Разделы</h2>
        <ul className="mt-4 divide-y divide-fd-border overflow-hidden rounded-xl border border-fd-border">
          {sections.map(([title, href, text]) => (
            <li key={href}>
              <Link
                href={href}
                className="flex flex-col gap-1 px-4 py-3 hover:bg-fd-accent sm:flex-row sm:items-baseline sm:justify-between"
              >
                <span className="font-medium">{title}</span>
                <span className="text-sm text-fd-muted-foreground">{text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </HomeLayout>
  );
}

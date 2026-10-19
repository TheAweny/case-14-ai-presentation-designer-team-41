import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="content" className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center px-6">
      <p className="text-sm text-fd-muted-foreground">404</p>
      <h1 className="docs-title mt-2 text-3xl font-semibold">Такой страницы нет</h1>
      <p className="mt-4 text-fd-muted-foreground">
        Адрес не совпадает ни с одной статьёй. Поиск по тексту открывается сочетанием{' '}
        <kbd className="rounded-md border border-fd-border px-1.5 py-0.5 text-xs">Ctrl</kbd>{' '}
        <kbd className="rounded-md border border-fd-border px-1.5 py-0.5 text-xs">K</kbd>.
      </p>
      <Link href="/" className="mt-6 text-fd-primary">
        На главную
      </Link>
    </main>
  );
}

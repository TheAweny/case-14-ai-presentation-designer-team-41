import { apiBaseUrl } from '@/lib/api';

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Deck generator</h1>
      <p className="text-ink-muted leading-relaxed">
        Upload a .pptx template, add a content pack, get a deck in the style of that template. The
        screens for upload, progress, variants, audit and export are built on top of this shell.
      </p>
      <dl className="border-border bg-surface-muted grid gap-1 rounded-lg border p-4 text-sm">
        <dt className="text-ink-muted">API endpoint</dt>
        <dd className="font-mono">{apiBaseUrl}</dd>
      </dl>
    </main>
  );
}

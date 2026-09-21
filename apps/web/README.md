# web

Next.js App Router front end: upload a template, watch the run progress, compare the three layout
variants, work through the audit findings and export the deck.

- Layout: source lives under `src/` (`src/app` for routes, `src/lib` for helpers), imported through
  the `@/*` alias. Styling is Tailwind v4, configured CSS-first in `src/app/globals.css`.
- Can import: `@lct/slide-renderer`, `@lct/contracts`, React and Next.
- Must not import: `@lct/pipeline`, `@lct/engine-client`, `apps/api` — the browser reaches the
  engine only through the API, over `NEXT_PUBLIC_API_URL`.
- Every user-facing string lives in `src/i18n/messages/{ru,en}.json` (next-intl, ICU syntax), never
  in a component. `ru.json` is the source: message keys are type-checked against it, and
  `messages.spec.ts` keeps the other dictionaries in step — same keys, same ICU arguments.
- The interface language comes from the `NEXT_LOCALE` cookie, then `Accept-Language`, then `ru`.
  There is no locale segment in the URL. The language of a generated deck is a separate setting.
- The tokens in `globals.css` style the product shell only. Everything that belongs to a user's
  template comes from the template profile at runtime and is never hardcoded here.

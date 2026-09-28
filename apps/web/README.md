# web

Next.js App Router front end: upload a template, watch the run progress, compare the three layout
variants, work through the audit findings and export the deck.

- Layout: source lives under `src/` (`src/app` for routes, `src/lib` for helpers), imported through
  the `@/*` alias. Styling is Tailwind v4, configured CSS-first in `src/app/globals.css`.
- Can import: `@lct/slide-renderer`, `@lct/contracts`, React and Next.
- Must not import: `@lct/pipeline`, `@lct/engine-client`, `apps/api`. The API answers only this
  web server: server code calls it through `lib/api.ts` with `API_SERVICE_TOKEN`, and the browser
  goes through the `/api/backend/...` route, which checks the session and adds the token. The
  browser never sees the token or the API address.
- Every user-facing string lives in `src/i18n/messages/{ru,en}/` (next-intl, ICU syntax), never
  in a component. One file per namespace: `file-bar.json` holds the `fileBar` strings of
  `file-bar.tsx`, and `index.ts` assembles the dictionary. `ru` is the source: message keys are
  type-checked against it, and `messages.spec.ts` keeps the other dictionaries in step — same keys,
  same ICU arguments.
- The interface language comes from the `NEXT_LOCALE` cookie, then `Accept-Language`, then `ru`.
  There is no locale segment in the URL. The language of a generated deck is a separate setting.
- The tokens in `globals.css` style the product shell only. Everything that belongs to a user's
  template comes from the template profile at runtime and is never hardcoded here.

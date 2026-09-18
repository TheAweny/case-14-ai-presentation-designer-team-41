# web

Next.js App Router front end: upload a template, watch the run progress, compare the three layout
variants, work through the audit findings and export the deck.

- Layout: source lives under `src/` (`src/app` for routes, `src/lib` for helpers), imported through
  the `@/*` alias. Styling is Tailwind v4, configured CSS-first in `src/app/globals.css`.
- Can import: `@lct/slide-renderer`, `@lct/contracts`, React and Next.
- Must not import: `@lct/pipeline`, `@lct/engine-client`, `apps/api` — the browser reaches the
  engine only through the API, over `NEXT_PUBLIC_API_URL`.
- The tokens in `globals.css` style the product shell only. Everything that belongs to a user's
  template comes from the template profile at runtime and is never hardcoded here.

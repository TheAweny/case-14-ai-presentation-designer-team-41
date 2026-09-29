# engine.api

FastAPI application that exposes the engine to the TypeScript side and wires the independent
layers together.

- Can import: every engine layer, FastAPI, the standard library.
- Must not import: any model client — the engine has no model calls at all.
- The service is reachable only from the API container; it is never published to the internet.

Endpoints (all requests/responses validate the generated contracts):

- `GET /health` — liveness.
- `POST /v1/template-profile` — parse a saved template into a design system, TemplateIR and a
  rendered cover (`previewDataUrl` may be null when LibreOffice is unavailable).
- `POST /v1/template-previews` — draw every slide of a template as PNGs for the library.
- `POST /v1/generation-profile` — reusable compositions with typography, before the timed run.
- `POST /v1/deck-import` — read a finished PPTX back as SlideIR with its pictures.
- `POST /v1/editable-decks` — the original MVP vertical slice: template + fixture slides → editable
  PPTX. This is the place that joins parser, layout and export.
- `POST /v1/composition-check` and `POST /v1/composition-decks` — bind texts to template slots,
  export a composition-faithful PPTX/PDF/previews, report missing fonts.
- `POST /v1/layouts` — lay one deck plan out as the requested variants on a local template.
- `POST /v1/exports` — write SlideIR slides onto their template as native PPTX and PDF (or previews
  for PNG/HTML downloads).
- `POST /v1/audit` and `POST /v1/composition-audit` — deterministic audit of generated or exported
  slides against a profile from `configs/audit.yaml`.

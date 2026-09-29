# cli

The `lct` command line: onboarding, service control and reproducible generation without the web UI.

```bash
yarn nx run cli:build
node apps/cli/dist/main.js help
```

Commands:

- `lct onboard` — setup wizard: run mode (Docker Compose or local), model provider (Yandex AI
  Studio, any OpenAI-compatible API, or offline recorded answers), administrator account, port
  checks and `.env`. Non-interactive flags: `--yes --provider ai-studio --api-key KEY
--folder-id b1g… --admin-email … --admin-password …`.
- `lct start | stop | status | restart [svc] | logs [svc]` — the stack in Docker Compose.
- `lct user admin [email]` — administrator of the installation (other users are created in the UI).
- `lct doctor` — checks the environment, model connection, accounts and service.
- `lct generate <config.yaml>` — the full pipeline from a run config: content pack, one plan,
  the requested layout variants (1–3), deterministic and contextual audit, PPTX and PDF, manifest.
  Requires the engine at `ENGINE_URL` and a model per the environment (see the root README).

A run config (`configs/run.example.yaml`) names the template, content, slide count, `layoutVariants`,
audit profile, model bindings, seed and output directory. Every file is recorded in
`runs/<run-id>/manifest.json` with hashes, stage timings and agent/prompt/model revisions;
`MODEL_PROVIDER=fake` runs the whole pipeline offline on recorded answers.

Inputs are validated up front by `@lct/input-validation`: template must be a `.pptx` under 50 MB,
content one of `.json/.md/.txt/.yaml/.yml` under 5 MB.

- Can import: `@lct/contracts`, `@lct/registry`, `@lct/run-store`, `@lct/pipeline`,
  `@lct/input-validation`, Node built-ins.
- Must not import: `apps/web`, `apps/api`, `.pptx` libraries.

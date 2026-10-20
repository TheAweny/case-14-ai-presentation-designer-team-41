# cli

`lct` — установка, управление сервисом и генерация презентаций из терминала.

```bash
yarn nx run cli:build
node apps/cli/dist/main.js help
```

На чистой Ubuntu используйте корневой `install.sh`: он установит системные зависимости,
соберёт CLI и передаст терминал мастеру. Подробности — в [портале документации](https://docs.lct.aweny.link/docs/cli/installation/).

[Руководство пользователя CLI](https://docs.lct.aweny.link/docs/cli/) содержит статьи со снимками меню,
примеры настройки, управление аккаунтами, диагностику и обслуживание. Обновление снимков:
`yarn nx run cli:docs-screenshots`.

Снимки записываются в `apps/docs/public/images/cli/` из реальных терминальных рендереров
с изолированной конфигурацией и локальными адаптерами Docker/API. Для съёмки нужны Node 22.15+,
uv, Bash (Git Bash по стандартному пути на Windows) и шрифт DejaVu Sans Mono.

Меню и полосы ожидания используют общий серо-светлый градиент с плавным переливом. `LCT_REDUCED_MOTION=1`
оставляет статичные цвета, `NO_COLOR=1` включает простой вывод. Скачивание показывает процент
только при известном размере; сборка и ожидание используют полосу без выдуманного процента.

- `lct` — меню; при отсутствии `.env` открывает мастер. Без TTY выводит справку.
- `lct onboard` — модель, администратор, адрес, порты, дополнительные возможности, запуск.
  Флаги: `--yes`, `--provider vk|ai-studio|openai|offline`, `--api-key`, `--project-id`,
  `--folder-id`, `--base-url`, `--model`, `--admin-email`, `--admin-name`, `--admin-password`,
  `--domain`, `--web-port`, `--api-port`, `--docs|--no-docs`, `--search|--no-search`, `--no-start`.
  Для секретов доступны `LCT_MODEL_API_KEY` и `LCT_INSTALL_ADMIN_PASSWORD` из shell.
- `lct configure` — адрес, порты и возможности с сохранением модели и администратора.
- `lct model` — изменение подключения модели.
- `lct start|stop|status|restart [service]|logs [service]` — Docker Compose.
- `lct user` — меню аккаунтов. Команды `list`, `add`, `role`, `disable`, `enable`, `password`,
  `revoke-sessions` работают через API. Для автоматизации: `--login-email`, `LCT_ADMIN_PASSWORD`,
  `--role`, `--name`, `--password`. Временная сессия отзывается после операции.
- `lct user admin [email]` — восстановление администратора через `.env` и перезапуск API.
- `lct doctor` — проверки окружения, секретов, модели и доступности сервиса.
- `lct backup` — согласованная копия Docker-установки: `.env`, `data/`, `runs/`, дамп PostgreSQL.
- `lct update` — обновление чистой ветки через fast-forward после резервного копирования.
- `lct generate <config.yaml>` — полный пайплайн по конфигу, локально или в API-контейнере.

A run config (`configs/run.example.yaml`) names the template, content, slide count, `layoutVariants`,
audit profile, model bindings, seed and output directory. Every file is recorded in
`runs/<run-id>/manifest.json` with hashes, stage timings and agent/prompt/model revisions;
`MODEL_PROVIDER=fake` используется тестами с записанными ответами; команда `generate`
требует живой модели и явно отказывается от fake provider.

Inputs are validated up front by `@lct/input-validation`: template must be a `.pptx` under 50 MB,
content one of `.json/.md/.txt/.yaml/.yml` under 5 MB.

- Can import: `@lct/contracts`, `@lct/registry`, `@lct/run-store`, `@lct/pipeline`,
  `@lct/input-validation`, Node built-ins.
- Must not import: `apps/web`, `apps/api`, `.pptx` libraries.

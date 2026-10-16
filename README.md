# Цифровой дизайнер презентаций

Целевой сервис собирает презентацию в стиле произвольного загруженного шаблона: разбирает чужой
`.pptx` как набор правил (дизайн-система, макеты, визуальные паттерны), принимает контент из
`.pptx`, `.pdf` или `.html`, строит по нему колоду на 10–15 слайдов, проверяет её аудитом и
экспортирует в `.pptx`, `.html` и `.pdf`.

Решение открытое и **не затачивается под конкретные шаблоны**: всё, что зависит от шаблона,
берётся из профиля шаблона, полученного при разборе файла. Описание кейса — в
[docs/CASE.md](docs/CASE.md).

## Статус соответствия

Требования и доказательства их выполнения перечислены в
[docs/COMPLIANCE.md](docs/COMPLIANCE.md). В `main` работает реальная генерация тремя
вариантами: Mastra → Qwen/Yandex → исходные композиции шаблона → PPTX/PDF/PNG, с общим
планом, индексом шаблона, иллюстрациями, fit-check/repair, детерминированным и контекстным
аудитом и сохранением прогресса. Три варианта на шаблонах организаторов собирались за
23–35 секунд (`docs/EVIDENCE.md`); это технические замеры, не SLA и не holdout.
Инструкция, evidence и ограничения — в [docs/GENERATION.md](docs/GENERATION.md).

## Как это устроено

Граница между языками проходит по признаку «есть ли здесь модель»:

- **TypeScript** — продукт и оркестрация: Next.js (интерфейс), NestJS (API), Mastra (агенты и
  workflow). Все обращения к моделям происходят только здесь, как и контекстные проверки аудита.
- **Python** — детерминированный движок документов: разбор `.pptx`, вёрстка, графики и таблицы,
  экспорт, рендер в PNG, детерминированные проверки аудита. Вызовов модели в движке нет.

Подробнее — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Требования к окружению

| Что    | Версия                                                       |
| ------ | ------------------------------------------------------------ |
| Node   | 22.13+ (`.nvmrc`)                                            |
| Yarn   | 4.x через Corepack, **только yarn**                          |
| Python | 3.12 (`.python-version`)                                     |
| uv     | 0.12+, **только uv**                                         |
| Docker | для запуска всей связки, включая LibreOffice в образе движка |

## Установка одной командой

```bash
curl -fsSL <raw-url>/install.sh | bash     # или ./install.sh из клона репозитория
```

Установщик проверит git, Node.js 22 и Docker, склонирует репозиторий в `~/lct26` (или
возьмёт тот, из которого запущен), соберёт CLI, положит команду `lct` в `~/.local/bin` и
запустит мастер `lct onboard`:

1. как запускать: Docker Compose или локально для разработки;
2. откуда брать модель: VK AI Space с Qwen 3.8 27B, моделью финала (нужны только API-ключ и
   Project ID), Yandex AI Studio (ключ и ID каталога), любой OpenAI-совместимый API или офлайн на
   записанных ответах; соединение сразу проверяется;
3. администратор интерфейса: почта, имя, пароль; ключ подписи сессий создаётся сам;
4. проверка портов, запись `.env` (доступен только владельцу), сборка, запуск и ожидание
   `/health`.

Без вопросов, например в CI. Модель финала, VK AI Space:

```bash
./install.sh --yes --provider vk --api-key KEY --project-id PROJECT_UUID \
  --admin-email admin@example.com --admin-password '...'
```

Yandex AI Studio:

```bash
./install.sh --yes --provider ai-studio --api-key KEY --folder-id b1g... \
  --admin-email you@example.com --admin-password '...'
```

После установки:

| Команда                       | Что делает                                                 |
| ----------------------------- | ---------------------------------------------------------- |
| `lct start`, `stop`, `status` | сервис в Docker Compose                                    |
| `lct logs [сервис]`           | логи                                                       |
| `lct user admin [почта]`      | администратор установки; остальных он заводит в интерфейсе |
| `lct doctor`                  | проверка окружения, модели, аккаунтов и сервиса            |
| `lct generate <config.yaml>`  | генерация колод по конфигу прогона                         |

### Модель

Модели перечислены в `configs/models.yaml` (подробности в [docs/MODELS.md](docs/MODELS.md)).
Сервис говорит с любым рантаймом с OpenAI chat API: свой vLLM или llama.cpp либо внешний
провайдер моделей с открытыми весами. В `.env` задаются `LLM_BASE_URL`, `VLM_BASE_URL`,
`MODEL_API_KEY` и, если провайдер называет модели по-своему, `LLM_MODEL` и `VLM_MODEL`.
Шлюзы, которым кроме ключа нужны заголовки, получают их из `MODEL_HEADERS` (`Имя=значение`
через запятую).

**VK AI Space** проще всего подключить мастером: `lct onboard` → «VK AI Space», ключ и Project
ID. Вручную это четыре строки `.env`; картинки слайдов читает та же модель, поэтому `VLM_BASE_URL`
и `VLM_MODEL` повторяют `LLM_BASE_URL` и `LLM_MODEL`:

```bash
LLM_BASE_URL=https://ai-demo.platformpreview.ru/api/inference-providers-router/00000000-0000-0000-0000-000000000001/v1
LLM_MODEL=qwen38-27b-fp8
MODEL_API_KEY=<API-ключ>
MODEL_HEADERS=Project-ID=<Project ID>
```

В интерфейсе: «Настройки → Модели → Добавить подключение → VK AI Space», ключ и Project ID. Модель
сама назначится ролям.

`MODEL_PROVIDER=fake` отвечает записанными ответами из `registry/recordings/` без сети и GPU,
`MODEL_PROVIDER=record` записывает ответы настоящей модели.

## Установка вручную

```bash
corepack enable
yarn install
uv sync
```

## Локальный запуск

```bash
cp .env.example .env
docker compose up -d postgres
set -a && source .env && set +a
yarn nx run api:serve     # NestJS на http://localhost:3001
yarn nx run web:serve     # Next.js на http://localhost:3000
uv run uvicorn engine.api:app --reload --port 8000   # движок
```

API и CLI используют PostgreSQL из `DATABASE_URL`. Compose публикует локальную БД на порту
`5433`, чтобы не конфликтовать с часто установленным системным PostgreSQL на `5432`.

## Запуск в Docker

```bash
cp .env.example .env
docker compose up --build
```

Поднимаются четыре контейнера: `web`, `api`, `engine` и `postgres`. Движок наружу не публикуется
и доступен только для API. PostgreSQL хранит состояния прогонов и метаданные артефактов в
именованном volume; PPTX, превью и входные файлы остаются в `runs/`.

## Запуск по конфигу

```bash
lct generate configs/run.example.yaml
```

Пример работает сразу после установки: шаблон и материал лежат в `examples/`. Для своей колоды
скопируйте конфиг и укажите в нём свои `.pptx` и файл с материалом (Markdown или текст).

Колоды собираются тем же путём, что в интерфейсе, и той же моделью: она берётся из `.env`
(`LLM_BASE_URL`, `LLM_MODEL`, `MODEL_API_KEY`, `MODEL_HEADERS`; `lct onboard` записывает их).
Шаблон один раз готовится (описание макетов кешируется в `runs/.template-index/`), затем строится
один план и параллельно три варианта вёрстки, каждый проходит аудит, выгружается в `.pptx` и
рендерится в `.pdf`. Время считается от начала сборки, подготовка шаблона в него не входит.

Если сервис запущен в Docker, `lct generate` сам выполняет сборку в контейнере API: там доступен
движок, а папки `data/` и `runs/` общие с машиной. Если движок запущен локально
(`ENGINE_URL`, по умолчанию `http://localhost:8000`), сборка идёт прямо в CLI.

Результат — `runs/<run-id>/`: `composition-plan.json` (общий план), `summary.json` (итог) и папка на
каждый вариант с `deck.pptx`, `previews/deck.pdf`, планом слайдов, аудитом, событиями и
`manifest.json` (хеши файлов, время по стадиям, ревизии агентов, промптов и шаблона).

## Проверки

```bash
yarn lint && yarn typecheck && yarn test && yarn build   # TypeScript
yarn lint:py && yarn typecheck:py && yarn test:py        # Python
yarn boundaries:py                                       # границы слоёв движка
yarn codegen                                             # Zod -> JSON Schema -> Pydantic
yarn licenses                                            # политика лицензий зависимостей
yarn docs:audit                                          # пересборка docs/AUDIT.md
```

## Ограничения

- Анализ входных данных и пользовательского шаблона выполняется на отдельном подготовительном
  этапе. После отправки пользователем запроса все три варианта колоды с обязательными
  артефактами должны быть готовы не более чем за 5 минут. План строится один раз и
  переиспользуется вариантами, а обращения к моделям по слайдам идут параллельно.
- Колода — 10–15 слайдов; одобренный план (чат, режим «План») допускает 10–60.
- API всегда собирает три различимых варианта (`dense`, `balanced`, `airy`) — это конкурсный
  gate. CLI-конфиг (`configs/run.example.yaml`) позволяет запросить от 1 до 3 в `layoutVariants`.
- Входные PDF/HTML проходят отдельные content adapters и нормализацию в `ContentPack`; PPTX
  остаётся форматом шаблона и также может быть источником контента.
- Промпты и конфиги агентов лежат отдельными файлами в `registry/agents/`, в коде их нет.
- Датасет организаторов, содержимое `runs/` и `.env` в репозиторий не попадают.
- Шрифты пользовательского шаблона берутся из самого файла во время работы; в образы кладём
  только свободные шрифты.

## Документация

- [DOCUMENTATION.md](DOCUMENTATION.md) — вся документация одним файлом с оглавлением по разделам.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — пайплайн и границы слоёв.
- [docs/GENERATION.md](docs/GENERATION.md) — реальный путь генерации, API, иллюстрации, замеры.
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) — соответствие требованиям кейса.
- [docs/MODELS.md](docs/MODELS.md) — какие модели используются и под какими лицензиями.
- [docs/AUDIT.md](docs/AUDIT.md) — список проверок (генерируется утилитой из `tools`).
- [docs/EDITOR-AUDIT.md](docs/EDITOR-AUDIT.md) — аудит UX редактора и его актуализация.
- [docs/EVIDENCE.md](docs/EVIDENCE.md) — замеры: 9 колод на шаблонах организаторов, время, аудит, токены.
- [docs/LICENSES.md](docs/LICENSES.md) — лицензии зависимостей (генерируется).
- [docs/DECISIONS.md](docs/DECISIONS.md) — журнал архитектурных решений.
- [CONTRIBUTING.md](CONTRIBUTING.md) — как участвовать.

## Лицензия

Apache License 2.0 — см. [LICENSE](LICENSE) и [NOTICE](NOTICE).

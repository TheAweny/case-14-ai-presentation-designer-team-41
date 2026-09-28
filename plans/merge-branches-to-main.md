# План: интеграция всех веток в main

Репозиторий: `lct-hackaton-2026/case-14-ai-presentation-designer-team-41`
Задача: объединить все ветки с актуальными наработками в `main`, разрешая конфликты в пользу
текущей версии `main`, проверить работоспособность и запушить результат.

## 1. Текущее состояние (по git-рефам и PR)

| Ветка                                          | SHA (tip) | Статус относительно main                                        |
| ---------------------------------------------- | --------- | --------------------------------------------------------------- |
| `origin/main`                                  | `6586946` | Актуальный main: PR #6–#17 (ML) уже влиты                       |
| `main` (локальная)                             | `2199c73` | Отстаёт от `origin/main` — нужен fast-forward                   |
| `skokovmaksimevg/cli-installer`                | `1ada1bb` | Открытый PR #18, конфликтов нет, CI зелёный → влить             |
| `dev/backend-next` (origin)                    | `f371f4b` | Коммиты поверх main: валидация входов run, прогресс lifecycle   |
| `dev/web-api-integration` (origin = локальная) | `a80f4bc` | Web UI + API-интеграция, persistent library, реальная генерация |
| `feat/web-ui` (origin)                         | `7af68d9` | Фронтенд на моковых данных                                      |
| `dev/pob-8-oss-contracts`                      | `95091b3` | Уже в main через merge-коммит `2199c73` (проверить rev-list)    |
| `dev/pob-10-editable-pptx`                     | `da46cfb` | Уже в main через `2199c73` (проверить rev-list)                 |
| `dev/integrated-progress`                      | `2f8a4cb` | Уже в main через `2199c73` (проверить rev-list)                 |
| `skokovmaksimevg/pob-23…pob-37`                | —         | Влиты PR #6–#17 либо отменены как устаревшие                    |

Примечание: ветки `dev/pob-8-oss-contracts`, `dev/pob-10-editable-pptx`, `dev/integrated-progress`
созданы раньше merge-коммита `2199c73` (chore: integrate team progress), который был запушен в
`origin/main` — ожидаемо являются предками main. Точный список веток, которые нужно вливать,
определяется по `git rev-list --count origin/main..<branch>` на шаге 3: вливаем только те, где счётчик > 0.

## 2. Стратегия слияния

- Последовательно `git merge --no-ff -X ours <branch>`.
- Опция `-X ours` означает: при конфликте всегда берётся версия из текущей ветки (main),
  неконфликтующие изменения из вливаемой ветки попадают в main. Это ровно требование
  «наши изменения приоритетны».
- Если после `-X ours` остаются конфликты (modify/delete, rename), разрешаем вручную в пользу
  main: `git checkout --ours -- <file>` или `git rm` для удалённых файлов.

Порядок вливания:

1. `skokovmaksimevg/cli-installer` (ML/CLI)
2. `dev/backend-next` (API runs lifecycle)
3. `dev/web-api-integration` (фронтенд + API, вбирает и web-ui)
4. `feat/web-ui` (остатки фронта, не вошедшие в пункт 3)

## 3. Шаги

```bash
# 0. Состояние рабочей копии
git status                 # проверяем незакоммиченные изменения (stash при необходимости)

# 1. Синхронизация main
git checkout main
git fetch origin
git merge --ff-only origin/main    # 2199c73 -> 6586946

# 2. Точный список веток, отстающих от main
for b in $(git for-each-ref --format='%(refname)' refs/remotes/origin); do
  echo "$b: $(git rev-list --count origin/main..$b)"
done

# 3. Вливание по очереди (вливаем только ветки со счётчиком > 0)
git merge --no-ff -X ours origin/skokovmaksimevg/cli-installer
git merge --no-ff -X ours origin/dev/backend-next
git merge --no-ff -X ours origin/dev/web-api-integration
git merge --no-ff -X ours origin/feat/web-ui
# при остаточных конфликтах: git checkout --ours -- <file>; git add <file>; git commit

# 4. Верификация (см. ниже)

# 5. Пуш
git push origin main
```

## 4. Верификация работоспособности

Тесты должны проходить без GPU и без сети (fake-провайдер, записанные ответы).

```bash
# TypeScript (Nx, 10 проектов)
yarn install
yarn nx run-many -t lint typecheck test

# Кодогенерация не должна давать диффов
yarn codegen && git diff --exit-code

# Python engine
uv sync
uv run pytest
uv run ruff check .
uv run pyright
uv run lint-imports
uv run write-golden-ir --check
```

Дополнительно: после пуша проверить, что платформенный CI на `main` (workflow `ci`) зелёный,
и статус PR #18 (если остался открытым — закрыть/дискарднуть через MCP).

## 5. Fallback

- **Не проходит верификация из-за кода вливаемых веток**: конфликтующие/сломанные файлы
  возвращаем к версии main (`git checkout HEAD -- <file>`, при необходимости `git rm`),
  т.к. приоритет — состояние main. После правок повторяем верификацию.
- **Пуш в main отклонён (protected branch)**: создаём интеграционную ветку
  `integrate-all-branches`, пушим её, открываем PR в main и мержим через платформу
  (GetMergeChecks → MergePullRequest).
- **Загрязнённая рабочая копия**: незакоммиченные изменения не трогаем — stash до начала,
  применяем после.

## 6. Чего не делаем

- Не коммитим `runs/`, `data/`, `.env` (правила AGENTS.md).
- Не отключаем линт/типы/границы модулей ради «прохождения».
- Не хардкодим под конкретный шаблон.

## 7. Итог (заполнено по факту)

Влиты в main и запушены (локальный merge, remote `cff7058` + фикс-коммиты):

- `chore(merge): integrate cli-installer` → `5f0878e`
- `chore(merge): integrate dev/backend-next` → `e1f57ad`
- `chore(merge): integrate dev/web-api-integration` → `0eb94c7`
- `chore(merge): integrate feat/web-ui` → `17220b1`
- `fix(integration): reconcile merged branches with main contracts` → `cff7058`
- `fix(integration): restore generation pipeline wiring across merged branches` → `b4960a0`

Ветки `dev/pob-8-oss-contracts`, `dev/pob-10-editable-pptx`, `dev/integrated-progress` и все
`skokovmaksimevg/pob-*` уже были в main (rev-list = 0) — не вливались повторно.

При реконсиляции гибридов (`-X ours` собрал части разных веток) восстановлены:

- web: новый фронтенд API (deck-chat, variant-review, writer-models)
- contracts: экспорт Composition*/GenerationProfile схем, регенерация Pydantic и схемы
- registry: каталог моделей из main, агенты ветки перепривязаны на валидные id
- engine api: /v1/generation-profile, /v1/composition-check, /v1/composition-decks
- engine-client: parseTemplateProfile, generationProfile, exportCompositions, checkCompositions
- pipeline: generatePresentation, workflow, провайдер генерации (GenerationProvider)

Проверено локально (без кэша Nx): lint/typecheck/test по 12 проектам, codegen (идемпотентен),
pytest 318, ruff, pyright 0 ошибок, lint-imports 0 нарушений, golden-фикстуры 9/9.
PR #18 закрыт (discarded) — его содержимое уже влито в main.

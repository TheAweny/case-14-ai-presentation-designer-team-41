# Быстрый старт

**[Открыть приложение →](https://lct.aweny.link/)** · **[Документация →](https://docs.lct.aweny.link/)**

1. Войдите в приложение и загрузите шаблон `.pptx` или `.potx`.
2. Добавьте материалы, при необходимости — брендбук, и опишите аудиторию, цель и число слайдов.
3. Выберите режим «Авто», сравните три варианта и откройте подходящий в редакторе. Скачайте результат в PowerPoint или PDF.

[Пошаговое руководство с примерами и экранами](https://docs.lct.aweny.link/docs/getting-started/)

### Запустить на своём сервере

На Ubuntu, под root или пользователем с `sudo`:

```bash
curl -fsSL https://raw.githubusercontent.com/TheAweny/case-14-ai-presentation-designer-team-41/main/install.sh | bash
```

Установщик подготовит окружение и откроет мастер настройки модели, администратора и адреса приложения. После установки проверьте сервисы:

```bash
lct doctor
lct status
```

[Требования и установка](https://docs.lct.aweny.link/docs/cli/installation/) · [Настройка модели](https://docs.lct.aweny.link/docs/cli/configuration/) · [Все команды CLI](https://docs.lct.aweny.link/docs/cli/reference/)

---

## Цифровой дизайнер презентаций

Сервис собирает **редактируемые презентации в стиле вашего шаблона**. План колоды общий, вёрстка — в трёх вариантах: плотном, сбалансированном и воздушном.

Шаблон задаёт макеты, палитру и типографику. Брендбук дополняет фирменные правила. Текст, таблицы и диаграммы остаются редактируемыми в PowerPoint; перед экспортом доступны превью и аудит.

[![CI](https://github.com/TheAweny/case-14-ai-presentation-designer-team-41/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/TheAweny/case-14-ai-presentation-designer-team-41/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Подробная документация

| Что нужно сделать                             | Где прочитать                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Собрать первую презентацию                    | [Начало работы](https://docs.lct.aweny.link/docs/getting-started/)                                                                 |
| Работать с проектами и шаблонами              | [Проекты](https://docs.lct.aweny.link/docs/guide/projects/)                                                                        |
| Выбрать между чатом, планом и авто            | [Ассистент](https://docs.lct.aweny.link/docs/guide/assistant/)                                                                     |
| Следить за сборкой и сравнить результаты      | [Генерация](https://docs.lct.aweny.link/docs/guide/generation/) · [Три варианта](https://docs.lct.aweny.link/docs/guide/variants/) |
| Исправить слайды и скачать файлы              | [Редактор и экспорт](https://docs.lct.aweny.link/docs/guide/editing/)                                                              |
| Настроить модели и доступы                    | [Настройки](https://docs.lct.aweny.link/docs/guide/settings/) · [Администрирование](https://docs.lct.aweny.link/docs/guide/admin/) |
| Узнать об инструментах и агентах              | [Инструменты](https://docs.lct.aweny.link/docs/guide/tools/) · [Агенты](https://docs.lct.aweny.link/docs/guide/agents/)            |
| Запускать и обслуживать сервис через терминал | [CLI](https://docs.lct.aweny.link/docs/cli/) · [Справочник команд](https://docs.lct.aweny.link/docs/cli/reference/)                |
| Подключить интеграцию                         | [API](https://docs.lct.aweny.link/docs/api/)                                                                                       |

Документация — статический справочник. Интерактивный Swagger находится **в приложении** по адресу `/api/docs`, если включён `API_DOCS_ENABLED=true`.

## Разработчикам

**TypeScript:** Next.js, NestJS, Mastra и Nx. **Python:** разбор шаблонов, вёрстка, рендер и экспорт. Контракты между слоями описаны в Zod; Python-модели генерируются из схем.

- [Локальная разработка, команды и проверки](CONTRIBUTING.md)
- [Архитектура и границы слоёв](docs/ARCHITECTURE.md)
- [Пайплайн генерации](docs/GENERATION.md)
- [Проверенные результаты и ограничения](docs/EVIDENCE.md)
- [Условия кейса](docs/CASE.md) · [Требования](spec/requirements.md)

Используйте **Yarn через Corepack** для TypeScript и **uv** для Python. Проверки и сборки запускаются через Nx; реальные ключи храните в `.env`.

---

[Apache License 2.0](LICENSE) · [Сторонние компоненты](NOTICE) · [Отчёт о лицензиях](docs/LICENSES.md)

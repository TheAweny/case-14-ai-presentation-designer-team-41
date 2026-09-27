#!/usr/bin/env bash
# Installs and starts the presentation designer with one command.
#
#   ./install.sh            asks a few questions in a terminal dialog, then starts the service
#   ./install.sh --yes      takes the defaults: Docker, offline answers, nothing asked
#
# Options:
#   --mode docker|local     Docker Compose (default) or a local dev setup with yarn and uv
#   --provider fake|api     recorded model answers (offline) or an OpenAI-compatible API
#   --base-url URL          API base URL ending in /v1, for --provider api
#   --api-key KEY           API key, for --provider api
#   --llm-model NAME        text model name as the API serves it
#   --vlm-model NAME        vision model name as the API serves it
#   --no-start              write the configuration and install, but do not start anything
#   --yes                   never ask; take the defaults for anything not given
set -euo pipefail

cd "$(dirname "$0")"

MODE=""
PROVIDER=""
BASE_URL=""
API_KEY=""
LLM_MODEL=""
VLM_MODEL=""
START=1
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --llm-model) LLM_MODEL="$2"; shift 2 ;;
    --vlm-model) VLM_MODEL="$2"; shift 2 ;;
    --no-start) START=0; shift ;;
    --yes | -y) ASSUME_YES=1; shift ;;
    -h | --help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

TITLE="Цифровой дизайнер презентаций"
DIALOG=0
if [[ $ASSUME_YES -eq 0 && -t 0 && -t 1 ]] && command -v whiptail >/dev/null 2>&1; then
  DIALOG=1
fi

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[31mОшибка:\033[0m %s\n' "$*" >&2; exit 1; }

# Asks a question with a default. Uses a dialog when there is one, a prompt otherwise, and the
# default without asking under --yes.
ask() {
  local question="$1" default="$2" secret="${3:-0}" answer
  if [[ $ASSUME_YES -eq 1 ]]; then
    printf '%s' "$default"
    return
  fi
  if [[ $DIALOG -eq 1 ]]; then
    local kind=--inputbox
    [[ $secret -eq 1 ]] && kind=--passwordbox
    answer=$(whiptail --title "$TITLE" "$kind" "$question" 10 72 "$default" 3>&1 1>&2 2>&3) ||
      fail "установка отменена"
  else
    if [[ $secret -eq 1 ]]; then
      read -r -s -p "$question [скрыто]: " answer </dev/tty; echo >&2
    else
      read -r -p "$question [$default]: " answer </dev/tty
    fi
    answer="${answer:-$default}"
  fi
  printf '%s' "$answer"
}

# Picks one of several options; each option is "tag|description".
choose() {
  local question="$1" default="$2"; shift 2
  if [[ $ASSUME_YES -eq 1 ]]; then
    printf '%s' "$default"
    return
  fi
  if [[ $DIALOG -eq 1 ]]; then
    local items=()
    for option in "$@"; do items+=("${option%%|*}" "${option#*|}"); done
    whiptail --title "$TITLE" --default-item "$default" --menu "$question" 16 76 6 \
      "${items[@]}" 3>&1 1>&2 2>&3 || fail "установка отменена"
    return
  fi
  echo "$question" >&2
  for option in "$@"; do echo "  ${option%%|*}  ${option#*|}" >&2; done
  local answer
  read -r -p "Выбор [$default]: " answer </dev/tty
  printf '%s' "${answer:-$default}"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    fail "нет Docker Compose: установите плагин docker compose (https://docs.docker.com/compose/install/)"
  fi
}

# Writes KEY=VALUE into .env, replacing the line if the key is there.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    local escaped
    escaped=$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')
    sed -i.bak "s|^${key}=.*|${key}=${escaped}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

wait_for() {
  local url="$1" name="$2" tries=90
  say "Жду, пока поднимется $name ($url)"
  until curl -fsS "$url" >/dev/null 2>&1; do
    tries=$((tries - 1))
    [[ $tries -le 0 ]] && fail "$name не ответил за 3 минуты; логи: docker compose logs"
    sleep 2
  done
}

[[ $DIALOG -eq 1 ]] && whiptail --title "$TITLE" --msgbox \
  "Установщик соберёт и запустит сервис: веб-интерфейс, API, движок и базу.\n\nОн задаст пару вопросов: как запускать и откуда брать модель." 12 72

MODE=${MODE:-$(choose "Как запускать сервис?" docker \
  "docker|Docker Compose: всё в контейнерах (рекомендуется)" \
  "local|Локально для разработки: yarn, uv, Node 22, Python 3.12")}
[[ $MODE == docker || $MODE == local ]] || fail "режим должен быть docker или local"

PROVIDER=${PROVIDER:-$(choose "Откуда брать ответы модели?" fake \
  "fake|Записанные ответы: без сети и GPU, для демо и тестов" \
  "api|OpenAI-совместимый API: vLLM, llama.cpp или внешний провайдер")}
[[ $PROVIDER == fake || $PROVIDER == api ]] || fail "провайдер должен быть fake или api"

if [[ $PROVIDER == api ]]; then
  BASE_URL=${BASE_URL:-$(ask "Base URL API (заканчивается на /v1)" "http://localhost:8080/v1")}
  API_KEY=${API_KEY:-$(ask "Ключ API" "" 1)}
  LLM_MODEL=${LLM_MODEL:-$(ask "Текстовая модель, как её называет API (пусто: из configs/models.yaml)" "")}
  VLM_MODEL=${VLM_MODEL:-$(ask "Модель со зрением, как её называет API (пусто: из configs/models.yaml)" "")}
fi

say "Проверяю окружение"
if [[ $MODE == docker ]]; then
  command -v docker >/dev/null 2>&1 || fail "нет Docker: https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || fail "Docker установлен, но не запущен или нет прав (группа docker)"
  compose version >/dev/null
else
  command -v node >/dev/null 2>&1 || fail "нет Node.js 22.13+: https://nodejs.org"
  node_major=$(node -p 'process.versions.node.split(".")[0]')
  [[ $node_major -ge 22 ]] || fail "нужен Node.js 22.13+, стоит $(node -v)"
  command -v uv >/dev/null 2>&1 || fail "нет uv: curl -LsSf https://astral.sh/uv/install.sh | sh"
  command -v corepack >/dev/null 2>&1 || fail "нет corepack: он входит в Node.js 22"
fi

say "Настраиваю .env"
if [[ ! -f .env ]]; then
  cp .env.example .env
fi
if [[ $PROVIDER == fake ]]; then
  set_env MODEL_PROVIDER fake
else
  set_env MODEL_PROVIDER ""
  set_env LLM_BASE_URL "$BASE_URL"
  set_env VLM_BASE_URL "$BASE_URL"
  set_env MODEL_API_KEY "$API_KEY"
  set_env LLM_MODEL "$LLM_MODEL"
  set_env VLM_MODEL "$VLM_MODEL"
fi
mkdir -p data runs

if [[ $MODE == docker ]]; then
  if [[ $START -eq 0 ]]; then
    say "Собираю образы"
    compose build
    say "Готово. Запуск: docker compose up -d"
    exit 0
  fi
  say "Собираю и запускаю контейнеры (первая сборка занимает несколько минут)"
  compose up -d --build
  wait_for http://localhost:3001/health "API"
  wait_for http://localhost:3000 "веб-интерфейс"
  msg="Сервис запущен.\n\nИнтерфейс: http://localhost:3000\nAPI:       http://localhost:3001\n\nОстановить: docker compose down"
elif [[ $START -eq 0 ]]; then
  msg="Настройка записана в .env. Установка: corepack yarn install && uv sync"
else
  say "Ставлю зависимости"
  corepack enable >/dev/null 2>&1 || true
  corepack yarn install --immutable
  uv sync
  say "Проверяю, что всё собирается: тесты движка и контрактов"
  uv run pytest -q -p no:warnings
  corepack yarn nx run-many -t test -p contracts pipeline registry
  msg="Окружение готово.\n\nЗапуск в трёх терминалах:\n  uv run uvicorn engine.api:app --port 8000\n  corepack yarn nx run api:serve\n  corepack yarn nx run web:serve\n\nБаза: docker compose up -d postgres"
fi

if [[ $DIALOG -eq 1 ]]; then
  whiptail --title "$TITLE" --msgbox "$msg" 16 72
fi
printf '\n%b\n' "$msg"

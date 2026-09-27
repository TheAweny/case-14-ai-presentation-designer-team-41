#!/usr/bin/env bash
# Installs the presentation designer and starts its setup wizard.
#
#   curl -fsSL <raw-url>/install.sh | bash
#   ./install.sh                         from a clone of the repository
#
# Flags are passed on to `lct onboard`, so the whole setup can run without questions:
#   ./install.sh --yes --provider ai-studio --api-key KEY --folder-id b1g... \
#     --admin-email you@example.com --admin-password '...'
#
# Environment:
#   LCT_REPO   repository to clone (default: the team repository on SourceCraft)
#   LCT_HOME   where to clone it (default: ~/lct26)
set -euo pipefail

REPO="${LCT_REPO:-https://git.sourcecraft.dev/lct-hackaton-2026/case-14-ai-presentation-designer-team-41.git}"
TARGET="${LCT_HOME:-$HOME/lct26}"
BIN_DIR="${HOME}/.local/bin"

bold=$'\033[1m'; dim=$'\033[2m'; red=$'\033[31m'; green=$'\033[32m'; reset=$'\033[0m'
step() { printf '%s◆%s %s\n' "$green" "$reset" "$*"; }
fail() { printf '%s✖ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }

printf '\n%s  Цифровой дизайнер презентаций%s\n%s  шаблон .pptx → три варианта колоды с аудитом%s\n\n' "$bold" "$reset" "$dim" "$reset"

command -v git >/dev/null 2>&1 || fail "нужен git"
command -v node >/dev/null 2>&1 || fail "нужен Node.js 22.13+: https://nodejs.org (или nvm install 22)"
node_major=$(node -p 'process.versions.node.split(".")[0]')
[[ $node_major -ge 22 ]] || fail "нужен Node.js 22.13+, стоит $(node -v)"
command -v corepack >/dev/null 2>&1 || fail "нет corepack: он входит в Node.js 22"
if ! command -v docker >/dev/null 2>&1; then
  printf '%s  Docker не найден: без него доступен только локальный режим (--mode local)%s\n' "$dim" "$reset"
fi
step "Окружение: node $(node -v), git $(git --version | cut -d' ' -f3)"

# Inside a clone: use it. Run through a pipe: clone or update the default location.
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [[ -n $here && -f $here/package.json && -d $here/apps/cli ]]; then
  ROOT="$here"
elif [[ -d $TARGET/.git ]]; then
  ROOT="$TARGET"
  step "Обновляю $ROOT"
  git -C "$ROOT" pull --ff-only --quiet
else
  step "Клонирую в $TARGET"
  git clone --quiet --depth 1 "$REPO" "$TARGET"
  ROOT="$TARGET"
fi
cd "$ROOT"

step "Ставлю зависимости и собираю CLI (первый раз пару минут)"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack yarn install --immutable >/dev/null
corepack yarn nx run cli:build --skip-nx-cache >/dev/null

mkdir -p "$BIN_DIR"
chmod +x "$ROOT/apps/cli/dist/main.js"
ln -sf "$ROOT/apps/cli/dist/main.js" "$BIN_DIR/lct"
step "Команда lct: $BIN_DIR/lct"
# shellcheck disable=SC2016 # $PATH is shown literally, as the command to type.
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) printf '%s  Добавьте в PATH: export PATH="%s:$PATH"%s\n' "$dim" "$BIN_DIR" "$reset" ;;
esac

# The wizard reads the terminal even when this script came through a pipe.
if [[ -t 0 ]]; then
  exec node "$ROOT/apps/cli/dist/main.js" onboard "$@"
elif { : </dev/tty; } 2>/dev/null; then
  exec node "$ROOT/apps/cli/dist/main.js" onboard "$@" </dev/tty
else
  exec node "$ROOT/apps/cli/dist/main.js" onboard --yes "$@"
fi

#!/usr/bin/env bash
# Ubuntu bootstrap. Build from source until public CLI artifacts exist.
# curl -fsSL https://raw.githubusercontent.com/TheAweny/case-14-ai-presentation-designer-team-41/main/install.sh | bash
# https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository
# https://nodejs.org/download/release/v22.23.3/ (includes Corepack).
set -Eeuo pipefail

usage() {
  cat <<'HELP'
LCT26 · установка дизайнера презентаций

  bash install.sh [аргументы onboard]
  curl -fsSL <raw-url>/install.sh | bash -s -- [аргументы onboard]

Ubuntu, root или sudo. Git, Docker/Compose/buildx и Node 22.13+
устанавливаются автоматически. CLI собирается из исходников через Yarn/Nx.

  --help, -h       справка без установки и записи файлов
  --yes           onboard без вопросов (укажите данные администратора)
  --mode local    пропустить Docker (Python/uv для разработки ставятся отдельно)
  --no-start      сохранить настройки без запуска сервиса

Все аргументы передаются в lct onboard без изменений.
Без терминала требуется явный --yes; секреты не записываются в лог bootstrap.

  LCT_HOME        каталог: /opt/lct26 для root, ~/lct26 для пользователя
  LCT_REPO        Git URL (по умолчанию GitHub TheAweny/case-14-ai-presentation-designer-team-41)
  LCT_REDUCED_MOTION=1  статичный градиент вместо переливов
  NO_COLOR        простой вывод без цветов и движения курсора

При запуске из клона используется этот клон, если не задан LCT_HOME.
Существующий репозиторий не обновляется. Для обновления используйте Git вручную.
Команда lct: /usr/local/bin для root, ~/.local/bin для пользователя.
HELP
}

is_root() { (( EUID == 0 )); }

check_platform() {
  [[ $(uname -s) == Linux && -r /etc/os-release ]] || die 'Нужна Ubuntu Linux.'
  # shellcheck source=/dev/null
  . /etc/os-release
  [[ ${ID:-} == ubuntu ]] || die 'Автоустановка поддерживает Ubuntu.'
  CODENAME=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
  [[ $CODENAME =~ ^[a-z]+$ ]] || die 'Не удалось определить выпуск Ubuntu.'
}

die() { printf '\n%sОшибка:%s %s\n' "${RED:-}" "${RESET:-}" "$*" >&"${UI_ERR:-2}"; exit 1; }

stop_spinner() {
  if [[ -n ${SPINNER_PID:-} ]]; then
    kill "$SPINNER_PID" 2>/dev/null || true
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=
    clear_frame
  fi
}

stop_download() {
  local pid
  for pid in "${DOWNLOAD_PID:-}" "${PROGRESS_PID:-}"; do
    [[ -n $pid ]] || continue
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  DOWNLOAD_PID= PROGRESS_PID=
}

cleanup() {
  local code=$?
  trap - EXIT ERR INT TERM
  stop_spinner
  stop_download
  [[ -z ${WORK:-} ]] || rm -rf -- "$WORK"
  [[ -z ${CLONE_STAGE:-} ]] || rm -rf -- "$CLONE_STAGE"
  if (( code != 0 )) && [[ -n ${LOG:-} ]]; then
    printf 'Подробности: %s\nПовторите установку после исправления ошибки.\n' "$LOG" >&"${UI_ERR:-2}"
  fi
  exit "$code"
}

on_error() {
  local code=$1 line=$2
  trap - ERR
  stop_spinner
  stop_download
  # Never print BASH_COMMAND or argv: arguments may contain credentials.
  printf 'Bootstrap failed: step=%s line=%s status=%s\n' "$STEP" "$line" "$code" >>"$LOG"
  printf '\n%sОшибка на этапе «%s» (код %s).%s\n' "$RED" "$STEP" "$code" "$RESET" >&"${UI_ERR:-2}"
  exit "$code"
}

status_line() {
  local text=$1 width=${COLUMNS:-80}
  [[ $width =~ ^[0-9]{1,3}$ ]] || width=80
  width=$((10#$width))
  (( width >= 12 )) || width=12
  if (( ${#text} > width - 5 )); then text="${text:0:width-8}..."; fi
  printf '%s' "$text"
}

terminal_width() {
  local width=${COLUMNS:-80} size=
  if [[ -t ${UI_OUT:-1} ]]; then
    size=$(stty size </dev/tty 2>/dev/null || true)
    [[ -z $size ]] || width=${size##* }
  fi
  [[ $width =~ ^[0-9]{1,3}$ ]] || width=80
  width=$((10#$width))
  (( width > 0 )) || width=80
  WIDTH=$width
}

select_palette() {
  COLOR_MODE=0
  case ${COLORTERM:-}:${TERM:-} in
    truecolor:*|24bit:*|*:*-direct|*:xterm-kitty|*:wezterm|*:foot|*:foot-extra) COLOR_MODE=24 ;;
    *:*256*) COLOR_MODE=256 ;;
    *:xterm*|*:screen*|*:tmux*|*:rxvt*|*:vt*|*:linux|*:ansi|*:cygwin) COLOR_MODE=16 ;;
  esac
}

init_ui() {
  RED= RESET= ACCENT= RICH=0
  select_palette
  if [[ -t 1 && ! ${NO_COLOR+x} && ${TERM:-dumb} != dumb && $COLOR_MODE != 0 ]]; then
    RICH=1 RED=$'\033[31m' RESET=$'\033[0m' ACCENT=$'\033[37m'
  fi
}

# Shared neutral palette: gray (160), light gray (208), soft white (240).
# Integer interpolation only: available before Node, with no color subprocesses.
gradient_shade() {
  local position=$1 width=$2 phase=$3 offset segment mix r g b
  [[ ${LCT_REDUCED_MOTION:-0} != 1 ]] || phase=0
  (( width > 1 )) || width=2
  offset=$(( (position * 768 / (width - 1) + phase) % 768 ))
  segment=$((offset / 256)) mix=$((offset % 256))
  case $segment in
    0) r=$((160 + 48 * mix / 256)) ;;
    1) r=$((208 + 32 * mix / 256)) ;;
    2) r=$((240 - 80 * mix / 256)) ;;
  esac
  g=$r b=$r
  if [[ ${COLOR_MODE:-256} == 24 ]]; then
    printf -v SHADE '\033[38;2;%s;%s;%sm' "$r" "$g" "$b"
  elif [[ ${COLOR_MODE:-256} == 256 ]]; then
    printf -v SHADE '\033[38;5;%sm' "$((232 + (r - 8 + 5) / 10))"
  elif [[ $COLOR_MODE == 16 ]]; then
    case $segment in
      0|1) SHADE=$'\033[37m' ;; 2) SHADE=$'\033[97m' ;;
    esac
  else
    SHADE=
  fi
}

gradient_string() {
  local text=$1 width=$2 phase=${3:-0} i
  SHADED_TEXT=$text
  [[ ${RICH:-0} == 1 ]] || return 0
  SHADED_TEXT=
  for ((i=0; i<${#text}; i++)); do
    gradient_shade "$i" "$width" "$phase"
    SHADED_TEXT+="$SHADE${text:i:1}"
  done
  SHADED_TEXT+=$RESET
}

gradient_text() {
  gradient_string "$1" "$2" 0
  printf '%s' "$SHADED_TEXT"
}

banner_art() {
  local width=${1:-80}
  [[ $width =~ ^[0-9]{1,3}$ ]] || width=80
  width=$((10#$width))
  if (( width >= 58 )); then
    cat <<'ART'
      __    __________         .-------------------.
     / /   / ____/_  __/       |  .-------------.  |
    / /   / /     / /         |  |      /\     |  |
   / /___/ /___  / /          |  |  ___/  \__ |  |
  /_____/\____/ /_/           |  '-------------'  |
                              '-------------------'
ART
  elif (( width >= 26 )); then
    cat <<'ART'
      __    __________
     / /   / ____/_  __/
    / /   / /     / /
   / /___/ /___  / /
  /_____/\____/ /_/
ART
  else
    printf '  [ LCT 26 ]\n'
  fi
}

show_banner() {
  local line
  if [[ ${RICH:-0} == 1 ]]; then
    terminal_width
    printf '\n'
    while IFS= read -r line; do
      gradient_text "${line:0:WIDTH-1}" "$WIDTH"
      printf '\n'
    done < <(banner_art "$WIDTH")
    printf '\n'
    for line in '  Дизайнер презентаций' '  Установка сервиса'; do
      gradient_text "${line:0:WIDTH-1}" "$WIDTH"
      printf '\n'
    done
    printf '\n'
  else
    printf '\nLCT26 · Дизайнер презентаций\n\n'
  fi
}

clear_frame() {
  # Erase through the bottom, including any extra rows reflowed by a resize.
  # Frames always leave the cursor at their first row, before any new text.
  printf '\r\033[J' >&"${UI_OUT:-1}"
}

render_frame() {
  local value=$1 label=$2 phase=$3 title suffix= content cells filled i distance glyph track= sweep head dim=
  case ${COLOR_MODE:-256} in
    24|256) dim=$'\033[38;5;238m' ;; 16) dim=$'\033[90m' ;;
  esac
  terminal_width
  # Leave the last column unused to avoid terminal auto-wrap.
  cells=$((WIDTH - 4))
  (( cells >= 1 )) || cells=1
  if (( value >= 0 )); then suffix=" $value%"; else suffix=' ···'; fi
  title="$STEP"
  [[ -z $label ]] || title="$title · $label"
  content=$((WIDTH - 1 - ${#suffix}))
  if (( content < 0 )); then title=; suffix=${suffix:0:WIDTH-1}; else title=${title:0:content}; fi
  if (( WIDTH >= 4 )); then
    track='  '
    filled=$((cells * value / 100))
    sweep=$(( (cells * 24 + 99) / 100 ))
    head=$(( (phase * (cells + sweep) / 768 + sweep - 1) % (cells + sweep) ))
    for ((i=0; i<cells; i++)); do
      glyph='─'
      if (( value >= 0 )); then
        (( i >= filled )) || glyph='━'
      else
        distance=$(( (head - i + cells + sweep) % (cells + sweep) ))
        (( distance >= sweep )) || glyph='━'
      fi
      if [[ $glyph == '━' ]]; then
        gradient_shade "$i" "$cells" "$phase"
        track+="$SHADE$glyph"
      else
        track+="$dim$glyph"
      fi
    done
    track+="$RESET"
  fi
  gradient_string "$title" "$WIDTH" "$phase"
  # Emit a whole frame in one builtin so signals cannot strand the cursor on row 2.
  # Erase below also removes reflowed rows after a terminal resize.
  printf '\r\033[J%s%s\n\r%s\033[1A\r' "$SHADED_TEXT" "$suffix" "$track"
}

brand_phase() {
  local micros=${1:-${EPOCHREALTIME/./}}
  PHASE=$(( (micros % 6000000) * 768 / 6000000 ))
  [[ ${LCT_REDUCED_MOTION:-0} != 1 ]] || PHASE=0
}

spinner() {
  trap - ERR EXIT
  trap 'exit 0' INT TERM
  local phase=0 value=-1 label= last_value= last_label= last_width=
  # Reserve two physical rows once; all subsequent frames reuse them.
  printf '\n\n\033[2A\r'
  while :; do
    value=-1 label=
    if [[ -s ${WORK:-}/progress ]]; then read -r value label <"$WORK/progress" || true; fi
    brand_phase
    phase=$PHASE
    terminal_width
    if [[ ${LCT_REDUCED_MOTION:-0} != 1 || $value != "$last_value" || $label != "$last_label" || $WIDTH != "$last_width" ]]; then
      render_frame "$value" "$label" "$phase"
      last_value=$value last_label=$label last_width=$WIDTH
    fi
    sleep 0.15
  done
}

run_step() {
  STEP=$1
  shift
  printf '\n[%s]\n' "$STEP" >>"$LOG"
  [[ -z ${WORK:-} ]] || : >"$WORK/progress"
  if [[ $RICH == 1 ]]; then
    spinner >&"${UI_OUT:-1}" & SPINNER_PID=$!
  else
    printf '  · '
    status_line "$STEP"
    printf '\n'
  fi
  # Calling through `if` or `||` would disable errexit inside the step function.
  # Subprocesses must never consume the script arriving through curl | bash.
  "$@" >>"$LOG" 2>&1 </dev/null
  stop_spinner
  printf '  %s✓%s ' "$ACCENT" "$RESET"
  status_line "$STEP"
  printf '\n'
}

system() {
  if is_root; then
    "$@"
  else
    # Reauthenticate on the real terminal, outside the redirected step log.
    if ! sudo -n -v >/dev/null 2>&1; then
      stop_spinner
      prepare_sudo >&"${UI_OUT:-1}" 2>&"${UI_ERR:-2}"
      if [[ ${RICH:-0} == 1 ]]; then spinner >&"${UI_OUT:-1}" & SPINNER_PID=$!; fi
    fi
    sudo -n -- "$@"
  fi
}

prepare_sudo() {
  is_root && return 0
  command -v sudo >/dev/null || die 'Нужен root или sudo для системных зависимостей.'
  printf '  Проверяю sudo для установки зависимостей…\n'
  if [[ -t 0 ]]; then
    sudo -v
  elif { : </dev/tty; } 2>/dev/null; then
    sudo -v </dev/tty
  else
    sudo -n -v || die 'Нет доступа sudo без пароля. Запустите установку из терминала или от root.'
  fi
}

install_prerequisites() {
  local missing=0 cmd
  for cmd in git curl tar xz sha256sum ss; do command -v "$cmd" >/dev/null || missing=1; done
  [[ -s /etc/ssl/certs/ca-certificates.crt ]] || missing=1
  if (( missing )); then
    system env DEBIAN_FRONTEND=noninteractive apt-get update
    system env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git curl ca-certificates xz-utils tar coreutils iproute2
  fi
}

write_progress() {
  # Rename, rather than truncate, so the renderer never reads half a snapshot.
  printf '%s %s\n' "$1" "$2" >"$WORK/progress.next"
  mv -f -- "$WORK/progress.next" "$WORK/progress"
}

byte_percent() {
  # Counts may be bytes or curl's tenths of a percent; both are integer ratios.
  local bytes=$1 total=$2
  PERCENT=-1
  # Bound arithmetic and reject shell expressions, negative/ambiguous sizes.
  [[ $bytes =~ ^[0-9]{1,15}$ && $total =~ ^[0-9]{1,15}$ ]] || return 0
  bytes=$((10#$bytes)) total=$((10#$total))
  (( total > 0 )) || return 0
  PERCENT=$((bytes * 100 / total))
  # Only curl's successful exit can commit 100, including empty downloads.
  (( PERCENT < 100 )) || PERCENT=99
}

transfer_record() {
  local record=$1 lower=${1,,} tenths
  if [[ $record =~ ^HTTP/[0-9.]+[[:space:]]+([0-9]{3}) ]]; then
    TRANSFER_STATUS=$((10#${BASH_REMATCH[1]}))
    TRANSFER_TOTAL= TRANSFER_CHUNKED=0 TRANSFER_READY=0 TRANSFER_PERCENT=-1 TRANSFER_HEADERS=1
    write_progress -1 "$TRANSFER_LABEL"
  elif [[ $lower =~ ^content-length:[[:space:]]*([0-9]+)[[:space:]]*$ ]]; then
    TRANSFER_TOTAL=${BASH_REMATCH[1]}
  elif [[ $lower == transfer-encoding:* ]]; then
    # A transfer encoding overrides Content-Length, regardless of header order.
    TRANSFER_CHUNKED=1
  elif [[ -z $record ]]; then
    TRANSFER_READY=1 TRANSFER_HEADERS=0
  elif (( TRANSFER_HEADERS )); then
    # Other HTTP headers, including a server's Warning header, are private data.
    :
  elif [[ $record == Warning:* || $record == curl:* ]]; then
    printf '%s\n' "$record" >>"$LOG"
    # curl emits its retry notice before waiting/restarting the transfer.
    TRANSFER_READY=0 TRANSFER_PERCENT=-1
    write_progress -1 "$TRANSFER_LABEL"
  elif [[ $record == *%* ]] && (( TRANSFER_READY && TRANSFER_STATUS >= 200 && TRANSFER_STATUS < 300 && ! TRANSFER_CHUNKED )); then
    # Only curl's numeric meter for a final response with a known total is valid.
    # Never sample the output file here: a retry may already have truncated it.
    [[ $record =~ ([0-9]{1,3})\.([0-9])% ]] || return 0
    tenths=$((10#${BASH_REMATCH[1]} * 10 + 10#${BASH_REMATCH[2]}))
    [[ $TRANSFER_TOTAL =~ ^[0-9]{1,15}$ ]] || return 0
    (( 10#$TRANSFER_TOTAL > 0 )) || return 0
    byte_percent "$tenths" 1000
    if (( PERCENT >= 0 )); then
      (( PERCENT >= TRANSFER_PERCENT )) || PERCENT=$TRANSFER_PERCENT
      TRANSFER_PERCENT=$PERCENT
      write_progress "$PERCENT" "$TRANSFER_LABEL"
    fi
  fi
}

collect_progress() {
  trap - ERR EXIT
  trap 'exit 0' INT TERM
  local TRANSFER_LABEL=$1 TRANSFER_STATUS=0 TRANSFER_TOTAL=
  local TRANSFER_CHUNKED=0 TRANSFER_READY=0 TRANSFER_PERCENT=-1 TRANSFER_HEADERS=0
  local char record= cr=0
  # Both CR meter frames and CRLF HTTP headers arrive on the same ordered stream.
  while IFS= read -r -n 1 -d '' char; do
    if [[ $char == $'\n' && $cr == 1 ]]; then cr=0; continue; fi
    cr=0
    if [[ $char == $'\r' || $char == $'\n' ]]; then
      [[ $char != $'\r' ]] || cr=1
      transfer_record "$record"
      record=
    elif (( ${#record} < 4096 )); then
      record+=$char
    fi
  done
  [[ -z $record ]] || transfer_record "$record"
}

download() {
  local label=${2##*/} code=0 pipe=$WORK/curl.progress
  write_progress -1 "$label"
  mkfifo "$pipe"
  collect_progress "$label" <"$pipe" & PROGRESS_PID=$!
  (
    trap - ERR EXIT INT TERM
    export LC_ALL=C
    # One renderer owns the terminal. Headers and curl's CR meter are consumed
    # privately; stdin must never eat the remainder of curl | bash.
    exec curl --fail --show-error --location --retry 3 --connect-timeout 20 \
      --proto '=https' --proto-redir '=https' --progress-bar --dump-header /dev/stderr \
      "$1" --output "$2" </dev/null 2>"$pipe"
  ) & DOWNLOAD_PID=$!
  if wait "$DOWNLOAD_PID"; then code=0; else code=$?; fi
  DOWNLOAD_PID=
  wait "$PROGRESS_PID"
  PROGRESS_PID=
  rm -f -- "$pipe"
  if (( code == 0 )); then write_progress 100 "$label"; else write_progress -1 "$label"; fi
  return "$code"
}

buildx_ok() {
  local version
  version=$(docker buildx version) || return 1
  [[ $version =~ v([0-9]+)\.([0-9]+)\. ]] || return 1
  (( BASH_REMATCH[1] > 0 || BASH_REMATCH[2] >= 17 ))
}

install_docker() {
  local package installed arch
  if ! command -v docker >/dev/null || ! docker compose version || ! buildx_ok; then
    # Do not silently remove another runtime or migrate existing APT sources.
    for package in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
      installed=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
      [[ $installed != 'install ok installed' ]] || die "Конфликт пакетов: $package. См. docs.docker.com/engine/install/ubuntu/."
    done
    [[ ! -e /etc/apt/sources.list.d/docker.list ]] || die 'Обнаружен docker.list: обновите существующий Docker по официальной инструкции.'
    arch=$(dpkg --print-architecture)
    [[ $arch =~ ^(amd64|arm64|armhf|s390x|ppc64el)$ ]] || die "Архитектура Docker не поддерживается: $arch"
    download https://download.docker.com/linux/ubuntu/gpg "$WORK/docker.asc"
    cat >"$WORK/docker.sources" <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $CODENAME
Components: stable
Architectures: $arch
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
    system install -d -m 0755 /etc/apt/keyrings
    system install -m 0644 "$WORK/docker.asc" /etc/apt/keyrings/docker.asc
    system install -m 0644 "$WORK/docker.sources" /etc/apt/sources.list.d/docker.sources
    system env DEBIAN_FRONTEND=noninteractive apt-get update
    system env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  docker compose version
  buildx_ok || die 'Нужен Docker buildx 0.17+.'
  DOCKER_BIN=$(command -v docker)
  if ! docker info; then
    if ! system "$DOCKER_BIN" info; then
      if [[ -d /run/systemd/system ]]; then
        system systemctl enable --now docker
      else
        system service docker start
      fi
      system "$DOCKER_BIN" info
    fi
    if ! docker info; then
      # Only Docker is elevated; checkout and .env remain owned by the caller.
      mkdir -p "$STATE/docker-bin"
      printf '#!/bin/bash\nexec sudo -- %q "$@"\n' "$DOCKER_BIN" >"$STATE/docker-bin/docker"
      chmod 0700 "$STATE/docker-bin/docker"
      DOCKER_PATH="$STATE/docker-bin:"
    fi
  fi
}

node_ok() {
  command -v node >/dev/null && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1);
  '
}

install_node() {
  local version=v22.23.3 arch archive base hash filename found=0
  if ! node_ok || ! command -v corepack >/dev/null || ! corepack --version; then
    case $(uname -m) in
      x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;;
      ppc64le) arch=ppc64le ;; s390x) arch=s390x ;;
      *) die 'Для этой архитектуры установите Node 22.13+ и Corepack вручную.' ;;
    esac
    archive="node-$version-linux-$arch.tar.xz"
    base="https://nodejs.org/download/release/$version"
    if [[ ! -x $STATE/$version/bin/node || ! -x $STATE/$version/bin/corepack ]]; then
      download "$base/SHASUMS256.txt" "$WORK/SHASUMS256.txt"
      download "$base/$archive" "$WORK/$archive"
      while read -r hash filename; do
        if [[ $filename == "$archive" && $hash =~ ^[a-f0-9]{64}$ ]]; then
          printf '%s  %s\n' "$hash" "$WORK/$archive" >"$WORK/node.sha256"
          found=1
          break
        fi
      done <"$WORK/SHASUMS256.txt"
      (( found == 1 )) || die 'В официальном манифесте нет SHA-256 архива Node.'
      sha256sum --check "$WORK/node.sha256"
      mkdir "$WORK/node"
      tar -xJf "$WORK/$archive" -C "$WORK/node" --strip-components=1 --no-same-owner
      [[ ! -e $STATE/$version ]] || die "Неполный runtime: удалите $STATE/$version и повторите установку."
      mv -- "$WORK/node" "$STATE/$version"
    fi
    export PATH="$STATE/$version/bin:$PATH"
  fi
  node_ok || die 'Нужен Node 22.13+.'
  NODE_BIN=$(command -v node)
  COREPACK_BIN=$(command -v corepack)
  node --version
  corepack --version
}

validate_checkout_owner() {
  [[ ! -L $ROOT && -d $ROOT ]] || die 'Каталог репозитория отсутствует или является символьной ссылкой.'
  [[ $(stat -c %u "$ROOT") == "$(id -u)" ]] || die 'Репозиторий принадлежит другому пользователю. Запустите install.sh от владельца без sudo.'
  [[ -w $ROOT ]] || die 'Нет прав записи в репозиторий.'
  [[ -f $ROOT/package.json && -f $ROOT/yarn.lock && -f $ROOT/apps/cli/src/main.ts ]] || die 'В каталоге нет исходников LCT26 CLI.'
  [[ -d $ROOT/packages && -f $ROOT/nx.json ]] || die 'Это не рабочее дерево LCT26.'
}

validate_repo() {
  validate_checkout_owner
  local top
  top=$(git -C "$ROOT" rev-parse --show-toplevel)
  [[ $(cd "$top" && pwd -P) == "$(cd "$ROOT" && pwd -P)" ]] || die 'Каталог не является корнем Git-репозитория.'
}

prepare_repo() {
  if [[ -e $ROOT || -L $ROOT ]]; then
    validate_repo
    printf 'Using existing checkout; no fetch, pull, reset or clean.\n'
  else
    mkdir -p -- "$(dirname "$ROOT")"
    CLONE_STAGE=$(mktemp -d "$(dirname "$ROOT")/.lct-clone.XXXXXXXX")
    git clone --quiet --depth 1 -- "$REPO" "$CLONE_STAGE/repo"
    # -T prevents a concurrent install from nesting one checkout inside another.
    mv -T -n -- "$CLONE_STAGE/repo" "$ROOT"
    [[ ! -d $CLONE_STAGE/repo ]] || die 'Каталог появился во время клонирования. Повторите запуск.'
    validate_repo
  fi
  ROOT=$(cd "$ROOT" && pwd -P)
  export LCT_HOME="$ROOT"
}

build_cli() {
  cd "$ROOT"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NX_DAEMON=false
  # Enable only Yarn in a writable directory, without changing global Node shims.
  mkdir -p "$STATE/yarn-bin"
  "$COREPACK_BIN" enable --install-directory "$STATE/yarn-bin" yarn
  export PATH="$STATE/yarn-bin:$PATH"
  "$COREPACK_BIN" yarn install --immutable
  "$COREPACK_BIN" yarn nx run cli:build --skip-nx-cache
  [[ -f $ROOT/apps/cli/dist/main.js ]] || die 'Сборка не создала apps/cli/dist/main.js.'
}

install_wrapper() {
  local wrapper
  mkdir -p -- "$BIN_DIR"
  if [[ -e $BIN_DIR/lct || -L $BIN_DIR/lct ]]; then
    if [[ -L $BIN_DIR/lct && $(readlink "$BIN_DIR/lct") == "$ROOT/apps/cli/dist/main.js" ]]; then
      : # Upgrade the original installer's symlink.
    elif [[ -f $BIN_DIR/lct && ! -L $BIN_DIR/lct ]] && head -n 2 "$BIN_DIR/lct" | grep -qx '# LCT26 bootstrap wrapper'; then
      :
    else
      die "Команда $BIN_DIR/lct уже существует и не создана этим установщиком."
    fi
  fi
  wrapper=$(mktemp "$BIN_DIR/.lct.XXXXXXXX")
  {
    printf '#!/bin/bash\n# LCT26 bootstrap wrapper\nset -euo pipefail\n'
    printf 'export LCT_HOME=%q\n' "$ROOT"
    printf 'export PATH=%q:"$PATH"\n' "${DOCKER_PATH:-}$STATE/yarn-bin:$(dirname "$NODE_BIN"):$(dirname "$COREPACK_BIN")"
    printf 'exec %q %q "$@"\n' "$NODE_BIN" "$ROOT/apps/cli/dist/main.js"
  } >"$wrapper"
  chmod 0755 "$wrapper"
  mv -Tf -- "$wrapper" "$BIN_DIR/lct"
}

configure_paths() {
  local source_dir=$1
  REPO=${LCT_REPO:-https://github.com/TheAweny/case-14-ai-presentation-designer-team-41.git}
  if is_root; then
    ROOT=${LCT_HOME:-/opt/lct26}
    STATE=/opt/lct26-runtime
    BIN_DIR=/usr/local/bin
  else
    ROOT=${LCT_HOME:-$HOME/lct26}
    STATE=${XDG_DATA_HOME:-$HOME/.local/share}/lct26/runtime
    BIN_DIR=$HOME/.local/bin
  fi
  if [[ -z ${LCT_HOME:-} && -n $source_dir && -d $source_dir/apps/cli && -f $source_dir/package.json ]]; then ROOT=$source_dir; fi
  [[ $ROOT == /* && $ROOT != / ]] || die 'LCT_HOME должен быть абсолютным путём к каталогу установки.'
}

main() {
  # Before mktemp, platform probes, sudo, network and all writes.
  local arg yes=0 source_dir= expect_mode=0 mode=docker
  for arg in "$@"; do
    case $arg in --help|-h) usage; return 0 ;; --yes|--yes=true) yes=1 ;; esac
    if (( expect_mode )); then
      mode=$arg
      expect_mode=0
    else
      case $arg in --mode) expect_mode=1 ;; --mode=*) mode=${arg#--mode=} ;; esac
    fi
  done
  [[ $expect_mode == 0 && ( $mode == docker || $mode == local ) ]] || die 'Укажите --mode docker или --mode local.'
  STEP=Подготовка LOG= WORK= CLONE_STAGE= SPINNER_PID= DOCKER_PATH= DOWNLOAD_PID= PROGRESS_PID=
  init_ui
  show_banner
  check_platform
  if [[ ! -t 0 ]] && ! { : </dev/tty; } 2>/dev/null && (( ! yes )); then
    die 'Нет терминала. Укажите --yes и данные администратора для onboard.'
  fi
  if [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]]; then
    source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
  fi
  configure_paths "$source_dir"
  # Reject a foreign checkout before installing dependencies or writing build output.
  if [[ -e $ROOT || -L $ROOT ]]; then validate_checkout_owner; fi
  umask 077
  local log_dir
  log_dir=$(mktemp -d "${TMPDIR:-/tmp}/lct-bootstrap.XXXXXXXX")
  LOG=$log_dir/install.log
  : >"$LOG"
  chmod 0600 "$LOG"
  exec 3>&1 4>&2
  UI_OUT=3 UI_ERR=4
  trap cleanup EXIT
  trap 'on_error "$?" "$LINENO"' ERR
  trap 'exit 130' INT
  trap 'exit 143' TERM
  WORK=$(mktemp -d "$log_dir/work.XXXXXXXX")
  [[ ! -L $STATE ]] || die 'Каталог runtime не должен быть символьной ссылкой.'
  mkdir -p "$STATE"
  [[ $(stat -c %u "$STATE") == "$(id -u)" ]] || die 'Runtime принадлежит другому пользователю.'
  chmod 0700 "$STATE"
  run_step '1/6 · Git и сертификаты' install_prerequisites
  run_step '2/6 · Репозиторий' prepare_repo
  if [[ $mode == local ]]; then
    run_step '3/6 · Локальный режим' printf 'Docker skipped (--mode local).\n'
  else
    run_step '3/6 · Docker и Compose' install_docker
  fi
  run_step '4/6 · Node и Corepack' install_node
  run_step '5/6 · Сборка CLI' build_cli
  run_step '6/6 · Команда lct' install_wrapper
  printf '\n%sГотово.%s Команда: %s/lct\nЛог: %s\n' "$ACCENT" "$RESET" "$BIN_DIR" "$LOG"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;; *) printf 'Добавьте в PATH: export PATH=%q:"$PATH"\n' "$BIN_DIR" ;;
  esac
  # Wizard output stays on the terminal, never in the bootstrap log.
  STEP=onboard
  if [[ -t 0 ]]; then
    "$BIN_DIR/lct" onboard "$@"
  elif { : </dev/tty; } 2>/dev/null; then
    "$BIN_DIR/lct" onboard "$@" </dev/tty
  else
    "$BIN_DIR/lct" onboard "$@" </dev/null
  fi
}

# Sourcing exposes functions for offline tests; it never starts installation.
if [[ -z ${BASH_SOURCE[0]:-} || ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi

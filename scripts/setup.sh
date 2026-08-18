#!/usr/bin/env bash

set -euo pipefail

readonly MINIMUM_NODE_MAJOR=22
readonly MINIMUM_NPM_MAJOR=11
readonly MINIMUM_TMUX_MAJOR=3
readonly MINIMUM_TMUX_MINOR=3
readonly HOMEBREW_INSTALL_URL='https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh'

usage() {
  printf 'Usage: %s [--skip-install] [--skip-build]\n' "$(basename "$0")" >&2
}

fail() {
  printf 'Setup failed: %s\n' "$1" >&2
  exit 1
}

warn() {
  printf 'Warning: %s\n' "$1" >&2
}

require_command() {
  local command="$1"
  local install_hint="$2"

  if ! command -v "$command" >/dev/null 2>&1; then
    fail "Required command \"$command\" is unavailable. $install_hint"
  fi
}

optional_command_status() {
  local command="$1"
  local purpose="$2"

  if command -v "$command" >/dev/null 2>&1; then
    printf '  [ready] %s: %s\n' "$command" "$purpose"
  else
    printf '  [optional] %s: %s\n' "$command" "$purpose"
  fi
}

node_is_supported() {
  local version
  local major

  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  version="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  major="${version%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && ((major >= MINIMUM_NODE_MAJOR))
}

npm_is_supported() {
  local version
  local major

  if ! command -v npm >/dev/null 2>&1; then
    return 1
  fi

  version="$(npm --version 2>/dev/null)" || return 1
  major="${version%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && ((major >= MINIMUM_NPM_MAJOR))
}

ripgrep_is_supported() {
  local candidate

  if [[ "$host_platform" == Darwin ]]; then
    if ! command -v brew >/dev/null 2>&1; then
      return 1
    fi
    candidate="$(brew --prefix ripgrep 2>/dev/null)/bin/rg" || return 1
  else
    candidate="$(command -v rg 2>/dev/null)" || return 1
  fi

  [[ -x "$candidate" ]] && "$candidate" --version >/dev/null 2>&1
}

ripgrep_command() {
  if [[ "$host_platform" == Darwin ]]; then
    printf '%s/bin/rg\n' "$(brew --prefix ripgrep)"
  else
    command -v rg
  fi
}

version_is_at_least() {
  local actual_major="$1"
  local actual_minor="$2"
  local expected_major="$3"
  local expected_minor="$4"

  ((actual_major > expected_major)) ||
    ((actual_major == expected_major && actual_minor >= expected_minor))
}

prepend_homebrew_bin() {
  local homebrew_prefix

  homebrew_prefix="$(brew --prefix)"
  case ":$PATH:" in
    *":$homebrew_prefix/bin:"*) ;;
    *) export PATH="$homebrew_prefix/bin:$PATH" ;;
  esac
}

ensure_homebrew() {
  local candidate

  if command -v brew >/dev/null 2>&1; then
    prepend_homebrew_bin
    return
  fi

  require_command curl 'Install curl before setup can bootstrap Homebrew.'
  printf 'Installing Homebrew...\n'
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL "$HOMEBREW_INSTALL_URL")"

  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$candidate" ]]; then
      eval "$("$candidate" shellenv)"
      prepend_homebrew_bin
      return
    fi
  done

  fail 'Homebrew installation completed without making brew available on PATH.'
}

run_as_root() {
  if ((EUID == 0)); then
    "$@"
    return
  fi

  require_command sudo 'Install sudo or run setup as root to install system packages.'
  sudo "$@"
}

install_required_runtime_dependencies() {
  local needs_node=false
  local needs_git=false
  local needs_tmux=false
  local needs_ripgrep=false

  if ! node_is_supported || ! npm_is_supported; then
    needs_node=true
  fi
  if ! command -v git >/dev/null 2>&1; then
    needs_git=true
  fi
  if ! command -v tmux >/dev/null 2>&1; then
    needs_tmux=true
  fi
  if ! ripgrep_is_supported; then
    needs_ripgrep=true
  fi

  if [[ "$needs_node" == false && "$needs_git" == false && "$needs_tmux" == false && "$needs_ripgrep" == false ]]; then
    return
  fi

  printf 'Installing missing required runtime dependencies...\n'

  case "$host_platform" in
    Darwin)
      local -a packages=()
      ensure_homebrew
      [[ "$needs_node" == true ]] && packages+=(node)
      [[ "$needs_git" == true ]] && packages+=(git)
      [[ "$needs_tmux" == true ]] && packages+=(tmux)
      [[ "$needs_ripgrep" == true ]] && packages+=(ripgrep)
      brew install "${packages[@]}"
      prepend_homebrew_bin
      ;;
    Linux)
      local -a packages=()
      [[ "$needs_node" == true ]] && packages+=(nodejs npm)
      [[ "$needs_git" == true ]] && packages+=(git)
      [[ "$needs_tmux" == true ]] && packages+=(tmux)
      [[ "$needs_ripgrep" == true ]] && packages+=(ripgrep)

      if command -v apt-get >/dev/null 2>&1; then
        run_as_root apt-get update
        run_as_root apt-get install -y "${packages[@]}"
      elif command -v dnf >/dev/null 2>&1; then
        run_as_root dnf install -y "${packages[@]}"
      elif command -v pacman >/dev/null 2>&1; then
        run_as_root pacman -Sy --needed --noconfirm "${packages[@]}"
      else
        fail 'Unable to find apt-get, dnf, or pacman to install required dependencies.'
      fi
      ;;
  esac

  hash -r
}

skip_install=false
skip_build=false
while (($# > 0)); do
  case "$1" in
    --skip-install)
      skip_install=true
      ;;
    --skip-build)
      skip_build=true
      ;;
    *)
      usage
      exit 2
      ;;
  esac
  shift
done

case "$(uname -s)" in
  Darwin)
    host_platform=Darwin
    package_manager_hint='Install the missing prerequisite with Homebrew, for example: brew install <package>.'
    ;;
  Linux)
    host_platform=Linux
    package_manager_hint='Install the missing prerequisite with your distribution package manager.'
    ;;
  *)
    fail "Supply Flow currently requires a macOS or Linux shell host because AI sessions use tmux."
    ;;
esac

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_directory="$(cd "$script_directory/.." && pwd -P)"

require_command bash "$package_manager_hint"
install_required_runtime_dependencies
require_command node "$package_manager_hint"
require_command npm "$package_manager_hint"
require_command git "$package_manager_hint"
require_command tmux "$package_manager_hint"
if ! ripgrep_is_supported; then
  fail "ripgrep is unavailable after installation. $package_manager_hint"
fi

node_version="$(node -p 'process.versions.node')"
node_major="${node_version%%.*}"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || ((node_major < MINIMUM_NODE_MAJOR)); then
  fail "Node.js $MINIMUM_NODE_MAJOR or newer is required; found \"$node_version\"."
fi

npm_version="$(npm --version)"
npm_major="${npm_version%%.*}"
if [[ ! "$npm_major" =~ ^[0-9]+$ ]] || ((npm_major < MINIMUM_NPM_MAJOR)); then
  fail "npm $MINIMUM_NPM_MAJOR or newer is required; found \"$npm_version\"."
fi

tmux_version="$(tmux -V)"
if [[ ! "$tmux_version" =~ ([0-9]+)\.([0-9]+) ]]; then
  fail "Unable to determine the installed tmux version from \"$tmux_version\"."
fi
tmux_major="${BASH_REMATCH[1]}"
tmux_minor="${BASH_REMATCH[2]}"
if ! version_is_at_least "$tmux_major" "$tmux_minor" "$MINIMUM_TMUX_MAJOR" "$MINIMUM_TMUX_MINOR"; then
  fail "tmux $MINIMUM_TMUX_MAJOR.$MINIMUM_TMUX_MINOR or newer is required; found \"$tmux_version\"."
fi

ripgrep_version="$("$(ripgrep_command)" --version | sed -n '1p')"

if [[ ! -f "$repository_directory/package-lock.json" ]]; then
  fail "package-lock.json is missing; unable to perform a reproducible npm install."
fi

if [[ "$skip_install" == false ]]; then
  printf 'Installing locked npm dependencies...\n'
  (
    cd "$repository_directory"
    npm ci
  )
fi

mkdir -p "$repository_directory/.supply-flow/projects"
mkdir -p "$repository_directory/.supply-flow/settings"

if [[ "$skip_build" == false ]]; then
  printf 'Building Supply Flow...\n'
  (
    cd "$repository_directory"
    npm run build
  )
fi

printf '\nRequired runtime\n'
printf '  [ready] node %s\n' "$node_version"
printf '  [ready] npm %s\n' "$npm_version"
printf '  [ready] %s\n' "$tmux_version"
printf '  [ready] git %s\n' "$(git --version)"
printf '  [ready] %s\n' "$ripgrep_version"

printf '\nAI providers\n'
optional_command_status codex 'Codex sessions'
optional_command_status claude 'Claude Code sessions'
optional_command_status gemini 'manual runner-only Gemini CLI sessions'
if ! command -v codex >/dev/null 2>&1 && ! command -v claude >/dev/null 2>&1; then
  warn "No supported web-app provider CLI was found. Install and authenticate Codex or Claude Code before creating an AI session."
fi

printf '\nOptional integrations\n'
optional_command_status gh 'GitHub pull request import, monitoring, and creation'
optional_command_status gws 'Google Docs reader'
optional_command_status slackread 'Slack channel reader'
optional_command_status circleci 'CircleCI interface setup'
optional_command_status gt 'Graphite stacked-branch workflow'
optional_command_status zip 'project export'
optional_command_status unzip 'project import'
optional_command_status lsof 'web app stop script'

if ! git config user.name >/dev/null 2>&1 || ! git config user.email >/dev/null 2>&1; then
  warn "Git user.name or user.email is not configured. Ticket branch creation requires git user.name."
fi

printf '\nSetup complete.\n'
printf 'Run npm run dev to start development, or scripts/start-web.sh after a production build.\n'
printf 'Use Settings > Setup AI interface to configure Slack, Google Docs, Confluence, Figma, and CircleCI access.\n'

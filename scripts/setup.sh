#!/usr/bin/env bash

set -euo pipefail

readonly MINIMUM_NODE_MAJOR=22
readonly MINIMUM_NPM_MAJOR=11
readonly MINIMUM_TMUX_MAJOR=3
readonly MINIMUM_TMUX_MINOR=3

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

version_is_at_least() {
  local actual_major="$1"
  local actual_minor="$2"
  local expected_major="$3"
  local expected_minor="$4"

  ((actual_major > expected_major)) ||
    ((actual_major == expected_major && actual_minor >= expected_minor))
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
    package_manager_hint='Install the missing prerequisite with Homebrew, for example: brew install <package>.'
    ;;
  Linux)
    package_manager_hint='Install the missing prerequisite with your distribution package manager.'
    ;;
  *)
    fail "Supply Flow currently requires a macOS or Linux shell host because AI sessions use tmux."
    ;;
esac

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_directory="$(cd "$script_directory/.." && pwd -P)"

require_command bash "$package_manager_hint"
require_command node "$package_manager_hint"
require_command npm "$package_manager_hint"
require_command git "$package_manager_hint"
require_command tmux "$package_manager_hint"

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

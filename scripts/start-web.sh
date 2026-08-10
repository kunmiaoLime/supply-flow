#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_PORT=3004

usage() {
  printf 'Usage: %s [--port <port>]\n' "$(basename "$0")" >&2
}

if [[ $# -eq 0 ]]; then
  port=$DEFAULT_PORT
elif [[ $# -eq 2 && "$1" == "--port" && "$2" =~ ^[0-9]+$ ]]; then
  port=$((10#$2))
else
  usage
  exit 2
fi

if ((port < 1 || port > 65535)); then
  usage
  exit 2
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_directory="$(cd "$script_directory/.." && pwd -P)"
web_directory="$repository_directory/apps/web"
next_binary="$repository_directory/node_modules/.bin/next"

if [[ ! -f "$web_directory/package.json" ]]; then
  printf 'Unable to find the Supply Flow web app at %s.\n' "$web_directory" >&2
  exit 1
fi

if [[ ! -x "$next_binary" ]]; then
  printf 'Unable to find Next.js. Run npm install before starting the web app.\n' >&2
  exit 1
fi

cd "$web_directory"
exec "$next_binary" start --port "$port"

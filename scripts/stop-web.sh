#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_PORT=3004
readonly STOP_TIMEOUT_SECONDS=5
readonly STOP_POLL_INTERVAL_SECONDS=0.1

usage() {
  printf 'Usage: %s [--port <port> | --all]\n' "$(basename "$0")" >&2
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

all_web_apps=false
if [[ $# -eq 0 ]]; then
  port=$DEFAULT_PORT
elif [[ $# -eq 1 && "$1" == "--all" ]]; then
  all_web_apps=true
  port=""
elif [[ $# -eq 2 && "$1" == "--port" && "$2" =~ ^[0-9]+$ ]]; then
  port=$((10#$2))
else
  usage
  exit 2
fi

if [[ -n "$port" ]] && ((port < 1 || port > 65535)); then
  usage
  exit 2
fi

if ! command -v lsof >/dev/null 2>&1; then
  fail "Unable to inspect web app listeners because lsof is not installed."
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repository_directory="$(cd "$script_directory/.." && pwd -P)"
expected_working_directory="$(cd "$repository_directory/apps/web" && pwd -P)"

run_lsof_for_listeners() {
  local output status

  if [[ -n "$1" ]]; then
    output="$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null)" || status=$?
  else
    output="$(lsof -nP -iTCP -sTCP:LISTEN -t 2>/dev/null)" || status=$?
  fi

  if [[ -z "${status:-}" ]]; then
    printf '%s\n' "$output"
    return 0
  fi

  if [[ $status -eq 1 ]]; then
    return 0
  fi

  printf 'Unable to inspect web app listeners with lsof.\n' >&2
  return "$status"
}

listener_process_ids_for_port() {
  run_lsof_for_listeners "$1"
}

all_listener_process_ids() {
  run_lsof_for_listeners ""
}

process_working_directory() {
  local process_id="$1"
  local output status

  if output="$(lsof -a -p "$process_id" -d cwd -Fn 2>/dev/null)"; then
    printf '%s\n' "$output" | awk '/^n/ { sub(/^n/, ""); print; exit }'
    return 0
  else
    status=$?
  fi

  if [[ $status -eq 1 ]]; then
    return 0
  fi

  printf 'Unable to inspect process %s with lsof.\n' "$process_id" >&2
  return "$status"
}

process_parent_id() {
  ps -p "$1" -o ppid= 2>/dev/null | tr -d ' '
}

process_command() {
  ps -p "$1" -o command= 2>/dev/null
}

is_next_cli_process() {
  local command="$1"

  [[ "$command" == *"/next dev"* || "$command" == *"/next start"* ||
    "$command" == "next dev"* || "$command" == "next start"* ]]
}

owning_next_process_id() {
  local listener_process_id="$1"
  local current_process_id="$listener_process_id"
  local parent_process_id command

  for _ in {1..8}; do
    command="$(process_command "$current_process_id")"
    if is_next_cli_process "$command"; then
      printf '%s\n' "$current_process_id"
      return 0
    fi

    parent_process_id="$(process_parent_id "$current_process_id")"
    if [[ -z "$parent_process_id" || "$parent_process_id" == "1" ||
      "$parent_process_id" == "$current_process_id" ]]; then
      break
    fi

    current_process_id="$parent_process_id"
  done

  printf '%s\n' "$listener_process_id"
}

append_unique_process_id() {
  local candidate="$1"
  local existing

  for existing in "${process_ids[@]:-}"; do
    if [[ "$existing" == "$candidate" ]]; then
      return
    fi
  done

  process_ids+=("$candidate")
}

pid_is_listed() {
  local process_id="$1"
  local process_id_list="$2"
  local candidate

  while IFS= read -r candidate; do
    if [[ "$candidate" == "$process_id" ]]; then
      return 0
    fi
  done <<< "$process_id_list"

  return 1
}

listener_output=""
if [[ "$all_web_apps" == true ]]; then
  if listener_output="$(all_listener_process_ids)"; then
    :
  else
    exit $?
  fi
else
  if listener_output="$(listener_process_ids_for_port "$port")"; then
    :
  else
    exit $?
  fi
fi

if [[ -z "$listener_output" && "$all_web_apps" == false ]]; then
  printf 'No web app is listening on port %s. Use --port <port> or --all to stop another Supply Flow web server.\n' "$port"
  exit 0
fi

process_ids=()
while IFS= read -r process_id; do
  [[ "$process_id" =~ ^[0-9]+$ ]] || continue

  working_directory=""
  if working_directory="$(process_working_directory "$process_id")"; then
    :
  else
    exit $?
  fi

  if [[ "$all_web_apps" == true ]]; then
    if [[ "$working_directory" == "$expected_working_directory" ]]; then
      append_unique_process_id "$process_id"
    fi
    continue
  fi

  if [[ "$working_directory" != "$expected_working_directory" ]]; then
    fail "Refusing to stop process $process_id on port $port: it is not the Supply Flow web app."
  fi

  append_unique_process_id "$process_id"
done <<< "$listener_output"

if ((${#process_ids[@]} == 0)); then
  if [[ "$all_web_apps" == true ]]; then
    printf 'No Supply Flow web app is listening.\n'
  else
    printf 'No web app is listening on port %s. Use --port <port> or --all to stop another Supply Flow web server.\n' "$port"
  fi
  exit 0
fi

target_process_ids=()
for process_id in "${process_ids[@]}"; do
  target_process_id="$(owning_next_process_id "$process_id")"
  target_working_directory=""
  if target_working_directory="$(process_working_directory "$target_process_id")"; then
    :
  else
    exit $?
  fi

  if [[ "$target_working_directory" != "$expected_working_directory" ]]; then
    fail "Refusing to stop process $target_process_id: it is not the Supply Flow web app."
  fi

  if ! pid_is_listed "$target_process_id" "$(printf '%s\n' "${target_process_ids[@]:-}")"; then
    target_process_ids+=("$target_process_id")
  fi
done

for target_process_id in "${target_process_ids[@]}"; do
  if kill -TERM "$target_process_id" 2>/dev/null; then
    continue
  fi

  if kill -0 "$target_process_id" 2>/dev/null; then
    fail "Unable to stop the Supply Flow web app process $target_process_id."
  fi
done

deadline=$((SECONDS + STOP_TIMEOUT_SECONDS))
while ((SECONDS < deadline)); do
  if [[ "$all_web_apps" == true ]]; then
    if listener_output="$(all_listener_process_ids)"; then
      :
    else
      exit $?
    fi
  else
    if listener_output="$(listener_process_ids_for_port "$port")"; then
      :
    else
      exit $?
    fi
  fi

  still_running=false
  for process_id in "${process_ids[@]}"; do
    if pid_is_listed "$process_id" "$listener_output"; then
      still_running=true
      break
    fi
  done

  if [[ "$still_running" == false ]]; then
    if [[ "$all_web_apps" == true ]]; then
      printf 'Stopped %s Supply Flow web app listener(s).\n' "${#process_ids[@]}"
    else
      printf 'Stopped the Supply Flow web app on port %s.\n' "$port"
    fi
    exit 0
  fi

  sleep "$STOP_POLL_INTERVAL_SECONDS"
done

fail "The Supply Flow web app did not stop within $STOP_TIMEOUT_SECONDS seconds."

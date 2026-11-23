#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

run_dir="$PACKAGE_ROOT/run"
mirror_pid_file="$run_dir/backup-mirror.pid"
server_pid_file="$run_dir/pocketbase.pid"
expected_binary="$PACKAGE_ROOT/bin/linux-amd64/pocketbase"

if [[ -f "$mirror_pid_file" ]]; then
  mirror_pid="$(cat -- "$mirror_pid_file")"
  if [[ "$mirror_pid" =~ ^[0-9]+$ ]] && kill -0 "$mirror_pid" 2>/dev/null; then
    if [[ -r "/proc/$mirror_pid/cmdline" ]] && tr '\0' ' ' < "/proc/$mirror_pid/cmdline" | grep -F -- "$SCRIPT_DIR/backup-mirror.sh" >/dev/null; then
      kill "$mirror_pid" 2>/dev/null || true
    fi
  fi
  rm -f -- "$mirror_pid_file"
fi

if [[ ! -f "$server_pid_file" ]]; then echo 'PocketBase ist nicht als laufend registriert.'; exit 0; fi
server_pid="$(cat -- "$server_pid_file")"
[[ "$server_pid" =~ ^[0-9]+$ ]] || { echo 'Ungültige PID-Datei.' >&2; exit 1; }
if kill -0 "$server_pid" 2>/dev/null; then
  if [[ -e "/proc/$server_pid/exe" ]]; then
    actual_binary="$(readlink -f -- "/proc/$server_pid/exe")"
    [[ "$actual_binary" == "$(readlink -f -- "$expected_binary")" ]] || { echo 'PID gehört nicht zur erwarteten PocketBase-Binärdatei.' >&2; exit 1; }
  fi
  kill "$server_pid"
  for _ in $(seq 1 20); do kill -0 "$server_pid" 2>/dev/null || break; sleep 0.5; done
fi
rm -f -- "$server_pid_file"
echo 'Ersatzteillager wurde gestoppt.'

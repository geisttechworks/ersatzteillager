#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_config

origin="$(config_get APP_ORIGIN)"
assert_origin "$origin"
host_name="$(config_get PB_HOST 127.0.0.1)"
port="$(config_get PB_PORT 8090)"
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || { echo 'PB_PORT muss zwischen 1 und 65535 liegen.' >&2; exit 1; }

binary="$PACKAGE_ROOT/bin/linux-amd64/pocketbase"
data_dir="$(resolve_app_path "$(config_get PB_DATA_DIR ./data/pb_data)")"
run_dir="$PACKAGE_ROOT/run"
log_dir="$PACKAGE_ROOT/logs"
pid_file="$run_dir/pocketbase.pid"
[[ -x "$binary" ]] || { echo 'PocketBase-Binärdatei fehlt oder ist nicht ausführbar. Führen Sie chmod +x aus.' >&2; exit 1; }
[[ -d "$PACKAGE_ROOT/pb_migrations" && -d "$PACKAGE_ROOT/pb_public" ]] || { echo 'Paket ist unvollständig.' >&2; exit 1; }
mkdir -p -- "$data_dir" "$run_dir" "$log_dir"

if [[ -f "$pid_file" ]]; then
  old_pid="$(cat -- "$pid_file")"
  if kill -0 "$old_pid" 2>/dev/null; then echo "PocketBase läuft bereits mit PID $old_pid." >&2; exit 1; fi
  rm -f -- "$pid_file"
fi

encryption_key="$(config_get PB_ENCRYPTION_KEY)"
extra_args=()
if [[ -n "$encryption_key" ]]; then
  [[ ${#encryption_key} -eq 32 ]] || { echo 'PB_ENCRYPTION_KEY muss leer oder genau 32 Zeichen lang sein.' >&2; exit 1; }
  export PB_ENCRYPTION_KEY="$encryption_key"
  extra_args+=(--encryptionEnv=PB_ENCRYPTION_KEY)
fi

nohup "$binary" "${extra_args[@]}" --dir "$data_dir" --migrationsDir "$PACKAGE_ROOT/pb_migrations" --publicDir "$PACKAGE_ROOT/pb_public" --indexFallback=true serve --http="$host_name:$port" --origins="$origin" >"$log_dir/pocketbase.log" 2>"$log_dir/pocketbase-error.log" &
server_pid=$!
printf '%s\n' "$server_pid" > "$pid_file"

healthy=0
for _ in $(seq 1 30); do
  sleep 0.5
  if curl --silent --fail --max-time 1 "http://$host_name:$port/api/health" >/dev/null; then healthy=1; break; fi
  kill -0 "$server_pid" 2>/dev/null || break
done
if [[ "$healthy" -ne 1 ]]; then
  kill "$server_pid" 2>/dev/null || true
  rm -f -- "$pid_file"
  echo 'PocketBase konnte nicht gestartet werden. Prüfen Sie logs/pocketbase-error.log.' >&2
  exit 1
fi

nohup bash "$SCRIPT_DIR/backup-mirror.sh" >"$log_dir/backup-mirror.log" 2>"$log_dir/backup-mirror-error.log" &
printf 'Ersatzteillager gestartet. Interner Endpunkt: http://%s:%s\nÖffentliche Adresse: %s\n' "$host_name" "$port" "$origin"

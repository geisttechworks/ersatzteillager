#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_config

command -v curl >/dev/null || { echo 'curl wird für die Ersteinrichtung benötigt.' >&2; exit 1; }
origin="$(config_get APP_ORIGIN)"
assert_origin "$origin"
port="$(config_get PB_PORT 8090)"
binary="$PACKAGE_ROOT/bin/linux-amd64/pocketbase"
data_dir="$(resolve_app_path "$(config_get PB_DATA_DIR ./data/pb_data)")"
[[ -x "$binary" ]] || { echo 'PocketBase-Binärdatei fehlt oder ist nicht ausführbar.' >&2; exit 1; }
mkdir -p -- "$data_dir"

read -r -p 'PocketBase-Superuser-E-Mail: ' superuser_email
read -r -s -p 'PocketBase-Superuser-Passwort: ' superuser_password; echo
read -r -p 'E-Mail des ersten App-Administrators: ' admin_email
read -r -p 'Anzeigename des ersten App-Administrators: ' admin_name
read -r -s -p 'Passwort des ersten App-Administrators: ' admin_password; echo
read -r -s -p 'Admin-Passwort wiederholen: ' admin_password_confirm; echo
[[ "$superuser_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ && "$admin_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo 'Ungültige E-Mail-Adresse.' >&2; exit 1; }
[[ ${#superuser_password} -ge 12 && ${#admin_password} -ge 12 ]] || { echo 'Passwörter müssen mindestens 12 Zeichen lang sein.' >&2; exit 1; }
[[ "$admin_password" == "$admin_password_confirm" ]] || { echo 'Die Admin-Passwörter stimmen nicht überein.' >&2; exit 1; }
[[ -n "$admin_name" ]] || { echo 'Der Anzeigename darf nicht leer sein.' >&2; exit 1; }

json_escape() { local value="$1"; value="${value//\\/\\\\}"; value="${value//\"/\\\"}"; printf '%s' "$value"; }
extra_args=()
encryption_key="$(config_get PB_ENCRYPTION_KEY)"
if [[ -n "$encryption_key" ]]; then
  [[ ${#encryption_key} -eq 32 ]] || { echo 'PB_ENCRYPTION_KEY muss leer oder genau 32 Zeichen lang sein.' >&2; exit 1; }
  export PB_ENCRYPTION_KEY="$encryption_key"
  extra_args+=(--encryptionEnv=PB_ENCRYPTION_KEY)
fi

"$binary" "${extra_args[@]}" --dir "$data_dir" --migrationsDir "$PACKAGE_ROOT/pb_migrations" --publicDir "$PACKAGE_ROOT/pb_public" superuser upsert "$superuser_email" "$superuser_password" >/dev/null 2>&1
temp_dir="$(mktemp -d)"
server_pid=''
cleanup() {
  superuser_password=''; admin_password=''; admin_password_confirm=''
  [[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null || true
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

"$binary" "${extra_args[@]}" --dir "$data_dir" --migrationsDir "$PACKAGE_ROOT/pb_migrations" --publicDir "$PACKAGE_ROOT/pb_public" serve --http="127.0.0.1:$port" --origins="$origin" >"$temp_dir/stdout.log" 2>"$temp_dir/stderr.log" &
server_pid=$!
for _ in $(seq 1 30); do sleep 0.5; curl --silent --fail --max-time 1 "http://127.0.0.1:$port/api/health" >/dev/null && break; done
curl --silent --fail --max-time 1 "http://127.0.0.1:$port/api/health" >/dev/null || { echo 'Temporäre PocketBase-Instanz wurde nicht erreichbar.' >&2; exit 1; }

auth_body="{\"identity\":\"$(json_escape "$superuser_email")\",\"password\":\"$(json_escape "$superuser_password")\"}"
auth_response="$(curl --silent --fail --request POST --header 'Content-Type: application/json' --data "$auth_body" "http://127.0.0.1:$port/api/collections/_superusers/auth-with-password")"
token="$(printf '%s' "$auth_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
[[ -n "$token" ]] || { echo 'Superuser-Authentisierung ist fehlgeschlagen.' >&2; exit 1; }
admin_body="{\"email\":\"$(json_escape "$admin_email")\",\"name\":\"$(json_escape "$admin_name")\",\"password\":\"$(json_escape "$admin_password")\",\"passwordConfirm\":\"$(json_escape "$admin_password")\",\"emailVisibility\":true,\"is_admin\":true}"
curl --silent --fail --request POST --header 'Content-Type: application/json' --header "Authorization: $token" --data "$admin_body" "http://127.0.0.1:$port/api/collections/users/records" >/dev/null
verify_body="{\"identity\":\"$(json_escape "$admin_email")\",\"password\":\"$(json_escape "$admin_password")\"}"
curl --silent --fail --request POST --header 'Content-Type: application/json' --data "$verify_body" "http://127.0.0.1:$port/api/collections/users/auth-with-password" >/dev/null
echo 'Einrichtung abgeschlossen. Starten Sie die Anwendung mit scripts/linux/start.sh.'

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
declare -A APP_CONFIG=()

load_config() {
  local env_file="$PACKAGE_ROOT/.env"
  [[ -f "$env_file" ]] || { echo '.env fehlt. Kopieren Sie .env.example nach .env und passen Sie die Werte an.' >&2; return 1; }
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" == *'='* ]] || { echo 'Ungültige Zeile in .env.' >&2; return 1; }
    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Ungültiger Variablenname: $key" >&2; return 1; }
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ${#value} -ge 2 && ( "$value" == \"*\" || "$value" == \'*\' ) ]]; then value="${value:1:${#value}-2}"; fi
    APP_CONFIG["$key"]="$value"
  done < "$env_file"
}

config_get() {
  local key="$1" default_value="${2-}"
  if [[ -n "${APP_CONFIG[$key]-}" ]]; then printf '%s' "${APP_CONFIG[$key]}"; else printf '%s' "$default_value"; fi
}

resolve_app_path() {
  local value="$1"
  [[ -n "$value" ]] || { echo 'Ein erforderlicher Pfadwert ist leer.' >&2; return 1; }
  if [[ "$value" = /* ]]; then printf '%s' "$value"; else printf '%s/%s' "$PACKAGE_ROOT" "${value#./}"; fi
}

assert_origin() {
  [[ "$1" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo 'APP_ORIGIN muss eine einzelne HTTPS-Origin ohne Pfad enthalten.' >&2; return 1; }
}

assert_safe_directory() {
  [[ -n "$1" && "$1" != '/' ]] || { echo 'Unsicherer Verzeichnispfad.' >&2; return 1; }
}

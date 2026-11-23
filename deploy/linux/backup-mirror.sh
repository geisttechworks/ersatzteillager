#!/usr/bin/env bash
set -euo pipefail
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
load_config

data_dir="$(resolve_app_path "$(config_get PB_DATA_DIR ./data/pb_data)")"
source_dir="$data_dir/backups"
target_dir="$(resolve_app_path "$(config_get PB_BACKUP_TARGET ./data/backups)")"
retention_days="$(config_get PB_BACKUP_RETENTION_DAYS 30)"
[[ "$retention_days" =~ ^[0-9]+$ && "$retention_days" -ge 1 && "$retention_days" -le 3650 ]] || { echo 'PB_BACKUP_RETENTION_DAYS muss zwischen 1 und 3650 liegen.' >&2; exit 1; }
assert_safe_directory "$target_dir"
mkdir -p -- "$target_dir" "$PACKAGE_ROOT/run"
printf '%s\n' "$$" > "$PACKAGE_ROOT/run/backup-mirror.pid"
trap 'rm -f -- "$PACKAGE_ROOT/run/backup-mirror.pid"' EXIT

while true; do
  if [[ -d "$source_dir" ]]; then
    while IFS= read -r -d '' backup; do
      name="$(basename -- "$backup")"
      destination="$target_dir/$name"
      if [[ ! -f "$destination" || "$(stat -c %s -- "$destination")" != "$(stat -c %s -- "$backup")" ]]; then
        cp -- "$backup" "$destination.partial"
        mv -f -- "$destination.partial" "$destination"
        printf 'Backup gespiegelt: %s\n' "$name"
      fi
    done < <(find "$source_dir" -maxdepth 1 -type f -name '*.zip' -print0)
  fi
  find "$target_dir" -maxdepth 1 -type f -name '*.zip' -mmin "+$((retention_days * 1440))" -print -delete
  sleep 300
done

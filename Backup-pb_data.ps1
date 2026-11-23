$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$source = Join-Path $projectRoot 'pb_data'
$destinationRoot = Join-Path $projectRoot 'backups'

if (-not (Test-Path -LiteralPath (Join-Path $source 'data.db'))) {
    throw 'pb_data/data.db wurde nicht gefunden.'
}
if (Get-Process -Name 'pocketbase' -ErrorAction SilentlyContinue) {
    throw 'PocketBase läuft. Stoppe PocketBase geordnet und starte das Backup danach erneut.'
}

New-Item -ItemType Directory -Path $destinationRoot -Force | Out-Null
$destination = Join-Path $destinationRoot ('pb_data_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
Copy-Item -LiteralPath $source -Destination $destination -Recurse
Write-Output "Vollständige PocketBase-Sicherung erstellt: $destination"

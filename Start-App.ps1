param(
    [string]$ListenHost = '127.0.0.1',
    [ValidateRange(1, 65535)][int]$PocketBasePort = 8090,
    [ValidateRange(1, 65535)][int]$AppPort = 5173,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pocketBase = Join-Path $projectRoot 'tools\pocketbase.exe'
$migrationsDir = Join-Path $projectRoot 'pb_migrations'
$dataDir = Join-Path $projectRoot 'pb_data'
$publicDir = Join-Path $projectRoot 'pb_public'
$scratchDir = Join-Path $projectRoot 'scratch'
$vite = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'

if (-not (Test-Path -LiteralPath $pocketBase)) {
    throw 'PocketBase fehlt. Führe zuerst Setup-Factory.ps1 gemäß README aus.'
}
if (-not (Test-Path -LiteralPath $vite)) {
    throw 'Node-Abhängigkeiten fehlen. Führe zuerst npm ci aus.'
}

New-Item -ItemType Directory -Path $scratchDir, $publicDir -Force | Out-Null
$apiOrigin = [UriBuilder]::new('http', $ListenHost, $PocketBasePort).Uri.GetLeftPart([UriPartial]::Authority)
$appOrigin = [UriBuilder]::new('http', $ListenHost, $AppPort).Uri.GetLeftPart([UriPartial]::Authority)
$healthUri = [uri]::new($apiOrigin + '/api/health')

try {
    Invoke-RestMethod -Uri $healthUri -TimeoutSec 2 | Out-Null
} catch {
    $pbArguments = '--dir "' + $dataDir + '" --migrationsDir "' + $migrationsDir + '" --publicDir "' + $publicDir + '" serve --http=' + $ListenHost + ':' + $PocketBasePort + ' --origins=' + $appOrigin
    Start-Process -FilePath $pocketBase -ArgumentList $pbArguments -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $scratchDir 'pocketbase.log') `
        -RedirectStandardError (Join-Path $scratchDir 'pocketbase-error.log')
}

try {
    Invoke-WebRequest -Uri $appOrigin -TimeoutSec 2 -UseBasicParsing | Out-Null
} catch {
    $env:VITE_POCKETBASE_URL = $apiOrigin
    Start-Process -FilePath 'node.exe' -ArgumentList ('"' + $vite + '" --host ' + $ListenHost + ' --port ' + $AppPort + ' --strictPort') `
        -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $scratchDir 'vite.log') `
        -RedirectStandardError (Join-Path $scratchDir 'vite-error.log')
}

if (-not $NoBrowser) {
    Start-Sleep -Seconds 2
    Start-Process $appOrigin
}

Write-Output "Entwicklungsumgebung gestartet: $appOrigin"

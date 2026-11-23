param(
    [string]$ListenHost = '127.0.0.1',
    [ValidateRange(1, 65535)][int]$PocketBasePort = 8090
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or $trimmed.IndexOf('=') -lt 1) { continue }
        $separator = $trimmed.IndexOf('=')
        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
        if ($name -match '^[A-Z][A-Z0-9_]*$' -and -not (Test-Path "Env:$name")) { Set-Item "Env:$name" $value }
    }
}
$origin = $env:APP_ORIGIN
if (-not $PSBoundParameters.ContainsKey('ListenHost') -and $env:PB_HOST) { $ListenHost = $env:PB_HOST }
if (-not $PSBoundParameters.ContainsKey('PocketBasePort') -and $env:PB_PORT) { $PocketBasePort = [int]$env:PB_PORT }
$pocketBase = Join-Path $projectRoot 'tools\pocketbase.exe'

if (-not $origin) {
    throw 'APP_ORIGIN muss in .env oder der Prozessumgebung auf die freigegebene HTTPS-Origin gesetzt sein.'
}
if ($origin -notmatch '^https://[A-Za-z0-9.-]+(?::[0-9]+)?$') {
    throw 'APP_ORIGIN muss eine einzelne HTTPS-Origin ohne Pfad enthalten.'
}
if (-not (Test-Path -LiteralPath $pocketBase)) {
    throw 'PocketBase fehlt. Führe zuerst Setup-Factory.ps1 gemäß README aus.'
}

$healthOrigin = [UriBuilder]::new('http', $ListenHost, $PocketBasePort).Uri.GetLeftPart([UriPartial]::Authority)
$healthUri = [uri]::new($healthOrigin + '/api/health')
try {
    Invoke-RestMethod -Uri $healthUri -TimeoutSec 2 | Out-Null
} catch {
    $logDir = Join-Path $projectRoot 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $configuredDataDir = if ($env:PB_DATA_DIR) { $env:PB_DATA_DIR } else { 'pb_data' }
    $dataDir = if ([IO.Path]::IsPathRooted($configuredDataDir)) { $configuredDataDir } else { Join-Path $projectRoot $configuredDataDir }
    $arguments = '--dir "' + $dataDir + '" --migrationsDir "' + (Join-Path $projectRoot 'pb_migrations') + '" --publicDir "' + (Join-Path $projectRoot 'pb_public') + '" serve --http=' + $ListenHost + ':' + $PocketBasePort + ' --origins=' + $origin
    Start-Process -FilePath $pocketBase -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'pocketbase-production.log') `
        -RedirectStandardError (Join-Path $logDir 'pocketbase-production-error.log')
}

Write-Output 'PocketBase wurde hinter der konfigurierten HTTPS-Origin gestartet.'

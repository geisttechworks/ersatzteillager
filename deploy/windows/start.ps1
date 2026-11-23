. (Join-Path $PSScriptRoot 'common.ps1')

$packageRoot = Get-PackageRoot
$config = Import-AppConfig $packageRoot
$origin = Get-ConfigValue $config 'APP_ORIGIN'
Assert-AppOrigin $origin
$hostName = Get-ConfigValue $config 'PB_HOST' '127.0.0.1'
$port = [int](Get-ConfigValue $config 'PB_PORT' '8090')
if ($port -lt 1 -or $port -gt 65535) { throw 'PB_PORT muss zwischen 1 und 65535 liegen.' }

$binary = Join-Path $packageRoot 'bin\windows-amd64\pocketbase.exe'
$dataDir = Resolve-AppPath $packageRoot (Get-ConfigValue $config 'PB_DATA_DIR' './data/pb_data')
$migrationDir = Join-Path $packageRoot 'pb_migrations'
$publicDir = Join-Path $packageRoot 'pb_public'
$runDir = Join-Path $packageRoot 'run'
$logDir = Join-Path $packageRoot 'logs'
$pidFile = Join-Path $runDir 'pocketbase.pid'

if (-not (Test-Path -LiteralPath $binary)) { throw 'PocketBase-Binärdatei für Windows fehlt.' }
foreach ($required in @($migrationDir, $publicDir)) { if (-not (Test-Path -LiteralPath $required)) { throw "Erforderlicher Paketordner fehlt: $required" } }
New-Item -ItemType Directory -Path $dataDir, $runDir, $logDir -Force | Out-Null

if (Test-Path -LiteralPath $pidFile) {
    $oldPid = [int](Get-Content -LiteralPath $pidFile -Raw)
    if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) { throw "PocketBase läuft bereits mit PID $oldPid." }
    Remove-Item -LiteralPath $pidFile -Force
}

$encryptionKey = Get-ConfigValue $config 'PB_ENCRYPTION_KEY'
if ($encryptionKey) {
    if ($encryptionKey.Length -ne 32) { throw 'PB_ENCRYPTION_KEY muss leer oder genau 32 Zeichen lang sein.' }
    $env:PB_ENCRYPTION_KEY = $encryptionKey
}

$arguments = @(
    "--dir=`"$dataDir`"",
    "--migrationsDir=`"$migrationDir`"",
    "--publicDir=`"$publicDir`"",
    '--indexFallback=true',
    'serve',
    "--http=$hostName`:$port",
    "--origins=$origin"
)
if ($encryptionKey) { $arguments = @('--encryptionEnv=PB_ENCRYPTION_KEY') + $arguments }

$process = Start-Process -FilePath $binary -ArgumentList $arguments -WorkingDirectory $packageRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir 'pocketbase.log') -RedirectStandardError (Join-Path $logDir 'pocketbase-error.log')
Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ascii

$healthUri = "http://$hostName`:$port/api/health"
$healthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-RestMethod -Uri $healthUri -TimeoutSec 1 | Out-Null; $healthy = $true; break } catch { if ($process.HasExited) { break } }
}
if (-not $healthy) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    throw 'PocketBase konnte nicht gestartet werden. Prüfen Sie logs/pocketbase-error.log.'
}

$mirrorScript = Join-Path $PSScriptRoot 'backup-mirror.ps1'
$pwsh = (Get-Process -Id $PID).Path
$mirrorPidFile = Join-Path $runDir 'backup-mirror.pid'
$mirrorRunning = $false
if (Test-Path -LiteralPath $mirrorPidFile) {
    $mirrorRunning = [bool](Get-BackupMirrorProcess $mirrorPidFile)
    if (-not $mirrorRunning) { Remove-Item -LiteralPath $mirrorPidFile -Force }
}
if (-not $mirrorRunning) {
    Start-Process -FilePath $pwsh -ArgumentList @('-NoProfile', '-File', "`"$mirrorScript`"") -WorkingDirectory $packageRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'backup-mirror.log') -RedirectStandardError (Join-Path $logDir 'backup-mirror-error.log') | Out-Null
}

Write-Output "Ersatzteillager gestartet. Interner Endpunkt: http://$hostName`:$port"
Write-Output "Öffentliche Adresse: $origin"

param(
    [Parameter(Mandatory = $true)][string]$DestinationDirectory,
    [string]$InstallRoot,
    [string]$DataRoot,
    [int]$PocketBasePort = 8090,
    [int]$SetupPort = 8080,
    [int]$HttpsPort = 8443,
    [switch]$SkipCertificateImport
)

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $InstallRoot) { $InstallRoot = Get-InstallerRoot }
if (-not $DataRoot) { $DataRoot = Get-ApplicationDataRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$DestinationDirectory = [IO.Path]::GetFullPath($DestinationDirectory)
Assert-SafeApplicationDirectory $DataRoot
Assert-SafeApplicationDirectory $DestinationDirectory

$dataDirectory = Join-Path $DataRoot 'pb_data'
if (-not (Test-Path -LiteralPath $dataDirectory)) { throw 'Es wurden noch keine Lagerdaten gefunden.' }

$pbBinary = Join-Path $InstallRoot 'bin\pocketbase.exe'
$caddyBinary = Join-Path $InstallRoot 'bin\caddy.exe'
$runDirectory = Join-Path $DataRoot 'run'
$wasRunning = [bool](Get-ControlledProcess (Join-Path $runDirectory 'pocketbase.json') $pbBinary)
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('ersatzteillager-backup-' + [guid]::NewGuid().ToString('N'))
$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$backupFile = Join-Path $DestinationDirectory "Ersatzteillager-Backup_$timestamp.zip"

try {
    if ($wasRunning) {
        Stop-ControlledProcess (Join-Path $runDirectory 'caddy.json') $caddyBinary
        Stop-ControlledProcess (Join-Path $runDirectory 'pocketbase.json') $pbBinary
    }
    New-Item -ItemType Directory -Path $DestinationDirectory, $temporaryDirectory -Force | Out-Null
    Copy-Item -LiteralPath $dataDirectory -Destination (Join-Path $temporaryDirectory 'pb_data') -Recurse -Force
    Compress-Archive -LiteralPath (Join-Path $temporaryDirectory 'pb_data') -DestinationPath $backupFile -CompressionLevel Optimal
    $hash = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath ($backupFile + '.sha256') -Value "$hash  $([IO.Path]::GetFileName($backupFile))" -Encoding ASCII
    Write-Output $backupFile
} finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($wasRunning) {
        & (Join-Path $InstallRoot 'scripts\Start-Ersatzteillager.ps1') -InstallRoot $InstallRoot -DataRoot $DataRoot `
            -PocketBasePort $PocketBasePort -SetupPort $SetupPort -HttpsPort $HttpsPort -NoBrowser `
            -SkipCertificateImport:$SkipCertificateImport | Out-Null
    }
}

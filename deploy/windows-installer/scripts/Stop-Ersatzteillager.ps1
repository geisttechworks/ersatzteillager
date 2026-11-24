param(
    [string]$InstallRoot,
    [string]$DataRoot
)

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $InstallRoot) { $InstallRoot = Get-InstallerRoot }
if (-not $DataRoot) { $DataRoot = Get-ApplicationDataRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)

$runDir = Join-Path $DataRoot 'run'
Stop-ControlledProcess (Join-Path $runDir 'caddy.json') (Join-Path $InstallRoot 'bin\caddy.exe')
Stop-ControlledProcess (Join-Path $runDir 'pocketbase.json') (Join-Path $InstallRoot 'bin\pocketbase.exe')
Remove-Item -LiteralPath (Join-Path $runDir 'runtime.json') -Force -ErrorAction SilentlyContinue
Write-Output 'Ersatzteillager wurde beendet. Die Lagerdaten bleiben erhalten.'

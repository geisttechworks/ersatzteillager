. (Join-Path $PSScriptRoot 'common.ps1')

$packageRoot = Get-PackageRoot
$runDir = Join-Path $packageRoot 'run'
$serverPidFile = Join-Path $runDir 'pocketbase.pid'
$mirrorPidFile = Join-Path $runDir 'backup-mirror.pid'
$expectedBinary = [IO.Path]::GetFullPath((Join-Path $packageRoot 'bin\windows-amd64\pocketbase.exe'))

if (Test-Path -LiteralPath $mirrorPidFile) {
    $mirrorProcess = Get-BackupMirrorProcess $mirrorPidFile
    if ($mirrorProcess) {
        Stop-Process -Id $mirrorProcess.Id -Force
        Wait-Process -Id $mirrorProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $mirrorPidFile -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path -LiteralPath $serverPidFile)) { Write-Output 'PocketBase ist nicht als laufend registriert.'; exit 0 }
$serverPid = [int](Get-Content -LiteralPath $serverPidFile -Raw)
$serverProcess = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
if ($serverProcess) {
    $actualPath = try { [IO.Path]::GetFullPath($serverProcess.Path) } catch { '' }
    if ($actualPath -ne $expectedBinary) { throw "PID $serverPid gehört nicht zur erwarteten PocketBase-Binärdatei." }
    Stop-Process -Id $serverPid
    Wait-Process -Id $serverPid -Timeout 20 -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $serverPidFile -Force -ErrorAction SilentlyContinue
Write-Output 'Ersatzteillager wurde gestoppt.'

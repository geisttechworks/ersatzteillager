param(
    [ValidateSet('App', 'Setup', 'Background')]
    [string]$Target = 'App'
)

$ErrorActionPreference = 'Stop'

try {
    & (Join-Path $PSScriptRoot 'Start-Ersatzteillager.ps1') -NoBrowser | Out-Null
    $dataRoot = if ($env:ERSATZTEILLAGER_DATA_ROOT) {
        [IO.Path]::GetFullPath($env:ERSATZTEILLAGER_DATA_ROOT)
    } else {
        [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Ersatzteillager'))
    }
    $runtimeFile = Join-Path $dataRoot 'run\runtime.json'
    if ($Target -ne 'Background' -and (Test-Path -LiteralPath $runtimeFile)) {
        $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
        $targetUrl = if ($Target -eq 'Setup') { [string]$runtime.setupUrl } else { [string]$runtime.appUrl }
        Start-Process $targetUrl | Out-Null
    }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show(
        "Ersatzteillager konnte nicht gestartet werden.`r`n`r`n$($_.Exception.Message)",
        'Start fehlgeschlagen', 'OK', 'Error'
    ) | Out-Null
    exit 1
}

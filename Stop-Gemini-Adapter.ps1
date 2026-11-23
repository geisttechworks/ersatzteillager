$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $PSScriptRoot '.gemini-adapter.pid'
$processIds = @()
$hasAdapterIdentity = $false

if (Test-Path -LiteralPath $pidFile) {
    try {
        $adapterInstance = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
        $processIds += [int]$adapterInstance.pid
        $hasAdapterIdentity = $true
    } catch {
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
}

if ($processIds.Count -eq 0) {
    $processIds = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

if ($processIds.Count -eq 0) {
    Write-Host 'Der Gemini-Adapter-Prozess läuft gerade nicht.'
    exit 0
}

$stopped = $false
foreach ($processId in $processIds) {
    $adapterProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $adapterProcess) { continue }
    if ($adapterProcess.ProcessName -ne 'node') {
        Write-Host 'Port 3000 wird nicht von Node verwendet. Es wurde nichts beendet.'
        exit 1
    }
    if ($hasAdapterIdentity) {
        $processStartedAt = $adapterProcess.StartTime.ToUniversalTime()
        $savedStartedAt = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$adapterInstance.startedAt).UtcDateTime
        if ([Math]::Abs(($processStartedAt - $savedStartedAt).TotalSeconds) -gt 15) {
            Write-Host 'Die Prozesskennung passt nicht zum Gemini-Adapter. Es wurde nichts beendet.'
            exit 1
        }
    }
    Stop-Process -Id $adapterProcess.Id -Force
    $stopped = $true
}

Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
if ($stopped) {
    Write-Host 'Gemini-Adapter wurde beendet.'
} else {
    Write-Host 'Der Gemini-Adapter-Prozess läuft gerade nicht.'
}

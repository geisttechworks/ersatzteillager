. (Join-Path $PSScriptRoot 'common.ps1')

$packageRoot = Get-PackageRoot
$config = Import-AppConfig $packageRoot
$dataDir = Resolve-AppPath $packageRoot (Get-ConfigValue $config 'PB_DATA_DIR' './data/pb_data')
$sourceDir = Join-Path $dataDir 'backups'
$targetDir = Resolve-AppPath $packageRoot (Get-ConfigValue $config 'PB_BACKUP_TARGET' './data/backups')
$retentionDays = [int](Get-ConfigValue $config 'PB_BACKUP_RETENTION_DAYS' '30')
if ($retentionDays -lt 1 -or $retentionDays -gt 3650) { throw 'PB_BACKUP_RETENTION_DAYS muss zwischen 1 und 3650 liegen.' }
Assert-SafeDirectory $targetDir
New-Item -ItemType Directory -Path $targetDir, (Join-Path $packageRoot 'run') -Force | Out-Null
$currentProcess = Get-Process -Id $PID
$controlValue = "$PID|$($currentProcess.StartTime.ToUniversalTime().Ticks)"
Set-Content -LiteralPath (Join-Path $packageRoot 'run\backup-mirror.pid') -Value $controlValue -Encoding ascii

try {
    while ($true) {
        if (Test-Path -LiteralPath $sourceDir) {
            foreach ($backup in Get-ChildItem -LiteralPath $sourceDir -Filter '*.zip' -File) {
                $destination = Join-Path $targetDir $backup.Name
                if (-not (Test-Path -LiteralPath $destination) -or (Get-Item -LiteralPath $destination).Length -ne $backup.Length) {
                    $partial = $destination + '.partial'
                    Copy-Item -LiteralPath $backup.FullName -Destination $partial -Force
                    Move-Item -LiteralPath $partial -Destination $destination -Force
                    Write-Output "Backup gespiegelt: $($backup.Name)"
                }
            }
        }
        $cutoff = (Get-Date).ToUniversalTime().AddDays(-$retentionDays)
        foreach ($expired in Get-ChildItem -LiteralPath $targetDir -Filter '*.zip' -File | Where-Object { $_.LastWriteTimeUtc -lt $cutoff }) {
            Remove-Item -LiteralPath $expired.FullName -Force
            Write-Output "Abgelaufenes Backup entfernt: $($expired.Name)"
        }
        Start-Sleep -Seconds 300
    }
} finally {
    Remove-Item -LiteralPath (Join-Path $packageRoot 'run\backup-mirror.pid') -Force -ErrorAction SilentlyContinue
}

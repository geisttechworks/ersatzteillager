param(
    [string]$PackagePath = (Join-Path $PSScriptRoot 'output\release\ersatzteillager-server-1.0.2-universal.zip')
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$tempParent = [IO.Path]::GetTempPath()
$testRoot = Join-Path $tempParent ('ersatzteillager-release-test-' + [guid]::NewGuid().ToString('N'))
$packageRoot = $null
$port = 0
$started = $false
$oldEnvironment = @{
    E2E_EMAIL = $env:E2E_EMAIL
    E2E_PASSWORD = $env:E2E_PASSWORD
    E2E_APP_URL = $env:E2E_APP_URL
    E2E_SKIP_WEB_SERVER = $env:E2E_SKIP_WEB_SERVER
    PLAYWRIGHT_BROWSERS_PATH = $env:PLAYWRIGHT_BROWSERS_PATH
}

function Get-FreeLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Assert-ChildPath([string]$Parent, [string]$Child) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not [IO.Path]::GetFullPath($Child).StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsicherer Testpfad.' }
}

try {
    if (-not (Test-Path -LiteralPath $PackagePath)) { throw "Serverpaket fehlt: $PackagePath" }
    $externalChecksum = $PackagePath + '.sha256'
    if (-not (Test-Path -LiteralPath $externalChecksum)) { throw 'Externe Paketprüfsumme fehlt.' }
    $expectedZipHash = ((Get-Content -LiteralPath $externalChecksum -Raw).Trim() -split '\s+')[0]
    $actualZipHash = (Get-FileHash -LiteralPath $PackagePath -Algorithm SHA256).Hash
    if ($actualZipHash -ne $expectedZipHash) { throw 'Die ZIP-Prüfsumme stimmt nicht.' }

    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    Assert-ChildPath $tempParent $testRoot
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $testRoot
    $packageRoot = (Get-ChildItem -LiteralPath $testRoot -Directory | Select-Object -First 1).FullName
    if (-not $packageRoot) { throw 'Das ZIP enthält keinen Paketordner.' }

    $projectLicensePath = Join-Path $packageRoot 'LICENSE.md'
    $thirdPartyPath = Join-Path $packageRoot 'licenses\THIRD-PARTY-LICENSES.md'
    if (-not (Test-Path -LiteralPath $projectLicensePath) -or -not (Test-Path -LiteralPath $thirdPartyPath)) {
        throw 'Projekt- oder Drittanbieter-Lizenz fehlt im Serverpaket.'
    }
    if ((Get-Content -LiteralPath $projectLicensePath -Raw) -notmatch 'PolyForm Noncommercial License 1\.0\.0') {
        throw 'Das Serverpaket enthält nicht die erwartete Projektlizenz.'
    }
    $thirdPartyLicenses = Get-Content -LiteralPath $thirdPartyPath -Raw
    if ($thirdPartyLicenses -notmatch '246 eindeutige npm-Pakete' -or $thirdPartyLicenses -notmatch 'Caddy 2\.11\.9') {
        throw 'Das Drittanbieter-Lizenzinventar im Serverpaket ist unvollständig.'
    }

    foreach ($line in Get-Content -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt')) {
        if ($line -notmatch '^([a-fA-F0-9]{64})\s{2}(.+)$') { throw 'Ungültige Zeile in SHA256SUMS.txt.' }
        $file = Join-Path $packageRoot ($Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar))
        Assert-ChildPath $packageRoot $file
        if (-not (Test-Path -LiteralPath $file)) { throw "Paketdatei fehlt: $($Matches[2])" }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $Matches[1]) { throw "Dateiprüfsumme stimmt nicht: $($Matches[2])" }
    }

    $port = Get-FreeLoopbackPort
    $envLines = Get-Content -LiteralPath (Join-Path $packageRoot '.env.example') | ForEach-Object {
        if ($_ -match '^PB_PORT=') { "PB_PORT=$port" }
        elseif ($_ -match '^PB_BACKUP_TARGET=') { 'PB_BACKUP_TARGET=./data/backups-target' }
        else { $_ }
    }
    Set-Content -LiteralPath (Join-Path $packageRoot '.env') -Value $envLines -Encoding utf8

    $suffix = [guid]::NewGuid().ToString('N')
    $superuserEmail = "superuser-$suffix@example.invalid"
    $adminEmail = "admin-$suffix@example.invalid"
    $plainPassword = ([guid]::NewGuid().ToString('N') + 'Aa1!')
    $securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
    & (Join-Path $packageRoot 'scripts\windows\setup.ps1') -SuperuserEmail $superuserEmail -SuperuserPassword $securePassword -AdminEmail $adminEmail -AdminName 'Release Test Admin' -AdminPassword $securePassword | Out-Null
    & (Join-Path $packageRoot 'scripts\windows\start.ps1') | Out-Null
    $started = $true

    $env:E2E_EMAIL = $adminEmail
    $env:E2E_PASSWORD = $plainPassword
    $env:E2E_APP_URL = "http://127.0.0.1:$port"
    $env:E2E_SKIP_WEB_SERVER = 'true'
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.playwright-browsers'
    npm run test:e2e --prefix $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Browserprüfung des Serverpakets ist fehlgeschlagen.' }

    $baseUri = "http://127.0.0.1:$port"
    $auth = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/_superusers/auth-with-password" -ContentType 'application/json' -Body (@{ identity = $superuserEmail; password = $plainPassword } | ConvertTo-Json)
    Invoke-RestMethod -Method Post -Uri "$baseUri/api/backups" -Headers @{ Authorization = $auth.token } -ContentType 'application/json' -Body (@{ name = 'release-verification.zip' } | ConvertTo-Json) | Out-Null
    $sourceBackup = Join-Path $packageRoot 'data\pb_data\backups\release-verification.zip'
    if (-not (Test-Path -LiteralPath $sourceBackup)) { throw 'PocketBase-Testbackup wurde nicht erzeugt.' }

    & (Join-Path $packageRoot 'scripts\windows\stop.ps1') | Out-Null
    $started = $false
    & (Join-Path $packageRoot 'scripts\windows\start.ps1') | Out-Null
    $started = $true
    $mirroredBackup = Join-Path $packageRoot 'data\backups-target\release-verification.zip'
    for ($attempt = 0; $attempt -lt 20 -and -not (Test-Path -LiteralPath $mirroredBackup); $attempt++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Path -LiteralPath $mirroredBackup)) { throw 'Das konfigurierte Backup-Ziel wurde nicht beliefert.' }

    Write-Output 'Release-Paketprüfung bestanden: Prüfsummen, leeres Setup, Migration, Login, Buchung, Import, PWA-Mobilablauf und Backup-Spiegel.'
} finally {
    if ($started -and $packageRoot) { & (Join-Path $packageRoot 'scripts\windows\stop.ps1') | Out-Null }
    $plainPassword = $null
    $securePassword = $null
    foreach ($entry in $oldEnvironment.GetEnumerator()) { Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value }
    if (Test-Path -LiteralPath $testRoot) {
        Assert-ChildPath $tempParent $testRoot
        for ($cleanupAttempt = 0; $cleanupAttempt -lt 20; $cleanupAttempt++) {
            try {
                Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction Stop
                break
            } catch {
                if ($cleanupAttempt -eq 19) { throw }
                Start-Sleep -Milliseconds 500
            }
        }
    }
}

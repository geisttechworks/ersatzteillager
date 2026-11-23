param(
    [string]$SuperuserEmail,
    [securestring]$SuperuserPassword,
    [string]$AdminEmail,
    [string]$AdminName,
    [securestring]$AdminPassword
)

. (Join-Path $PSScriptRoot 'common.ps1')

function Convert-ToPlainText([securestring]$Value) { return [Net.NetworkCredential]::new('', $Value).Password }
function Read-ConfirmedPassword([string]$Prompt) {
    while ($true) {
        $first = Read-Host $Prompt -AsSecureString
        $second = Read-Host 'Passwort wiederholen' -AsSecureString
        $plainFirst = Convert-ToPlainText $first
        $plainSecond = Convert-ToPlainText $second
        if ($plainFirst.Length -lt 12) { Write-Warning 'Mindestens 12 Zeichen erforderlich.'; continue }
        if ($plainFirst -ne $plainSecond) { Write-Warning 'Die Passwörter stimmen nicht überein.'; continue }
        return $first
    }
}
function Assert-Email([string]$Value) { if ($Value -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Ungültige E-Mail-Adresse.' } }

$packageRoot = Get-PackageRoot
$config = Import-AppConfig $packageRoot
$origin = Get-ConfigValue $config 'APP_ORIGIN'
Assert-AppOrigin $origin
$port = [int](Get-ConfigValue $config 'PB_PORT' '8090')
$dataDir = Resolve-AppPath $packageRoot (Get-ConfigValue $config 'PB_DATA_DIR' './data/pb_data')
$binary = Join-Path $packageRoot 'bin\windows-amd64\pocketbase.exe'
$migrationDir = Join-Path $packageRoot 'pb_migrations'
$publicDir = Join-Path $packageRoot 'pb_public'
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('ersatzteillager-package-setup-' + [guid]::NewGuid().ToString('N'))
$process = $null
$plainSuperuser = $null
$plainAdmin = $null

try {
    if (-not (Test-Path -LiteralPath $binary)) { throw 'PocketBase-Binärdatei fehlt.' }
    New-Item -ItemType Directory -Path $dataDir, $tempDir -Force | Out-Null
    if (-not $SuperuserEmail) { $SuperuserEmail = Read-Host 'PocketBase-Superuser-E-Mail' }
    Assert-Email $SuperuserEmail
    if (-not $SuperuserPassword) { $SuperuserPassword = Read-ConfirmedPassword 'PocketBase-Superuser-Passwort' }
    if (-not $AdminEmail) { $AdminEmail = Read-Host 'E-Mail des ersten App-Administrators' }
    Assert-Email $AdminEmail
    if (-not $AdminName) { $AdminName = Read-Host 'Anzeigename des ersten App-Administrators' }
    if ([string]::IsNullOrWhiteSpace($AdminName)) { throw 'Der Anzeigename darf nicht leer sein.' }
    if (-not $AdminPassword) { $AdminPassword = Read-ConfirmedPassword 'Passwort des ersten App-Administrators' }
    $plainSuperuser = Convert-ToPlainText $SuperuserPassword
    $plainAdmin = Convert-ToPlainText $AdminPassword
    if ($plainSuperuser.Length -lt 12 -or $plainAdmin.Length -lt 12) { throw 'Passwörter müssen mindestens 12 Zeichen lang sein.' }

    $encryptionKey = Get-ConfigValue $config 'PB_ENCRYPTION_KEY'
    $commonArgs = @('--dir', $dataDir, '--migrationsDir', $migrationDir, '--publicDir', $publicDir)
    if ($encryptionKey) {
        if ($encryptionKey.Length -ne 32) { throw 'PB_ENCRYPTION_KEY muss leer oder genau 32 Zeichen lang sein.' }
        $env:PB_ENCRYPTION_KEY = $encryptionKey
        $commonArgs = @('--encryptionEnv=PB_ENCRYPTION_KEY') + $commonArgs
    }
    & $binary @commonArgs superuser upsert $SuperuserEmail $plainSuperuser *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Migrationen oder Superuser-Einrichtung sind fehlgeschlagen.' }

    $serveArgs = @(
        "--dir=`"$dataDir`"",
        "--migrationsDir=`"$migrationDir`"",
        "--publicDir=`"$publicDir`"",
        'serve',
        "--http=127.0.0.1:$port",
        "--origins=$origin"
    )
    if ($encryptionKey) { $serveArgs = @('--encryptionEnv=PB_ENCRYPTION_KEY') + $serveArgs }
    $process = Start-Process -FilePath $binary -ArgumentList $serveArgs -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $tempDir 'stdout.log') -RedirectStandardError (Join-Path $tempDir 'stderr.log')
    $baseUri = "http://127.0.0.1:$port"
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) { Start-Sleep -Milliseconds 500; try { Invoke-RestMethod -Uri "$baseUri/api/health" -TimeoutSec 1 | Out-Null; $ready = $true; break } catch { if ($process.HasExited) { break } } }
    if (-not $ready) { throw 'Temporäre PocketBase-Instanz wurde nicht erreichbar.' }

    $auth = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/_superusers/auth-with-password" -ContentType 'application/json' -Body (@{ identity = $SuperuserEmail; password = $plainSuperuser } | ConvertTo-Json)
    $body = @{ email = $AdminEmail; name = $AdminName; password = $plainAdmin; passwordConfirm = $plainAdmin; emailVisibility = $true; is_admin = $true } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/users/records" -Headers @{ Authorization = $auth.token } -ContentType 'application/json' -Body $body | Out-Null
    $verify = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/users/auth-with-password" -ContentType 'application/json' -Body (@{ identity = $AdminEmail; password = $plainAdmin } | ConvertTo-Json)
    if (-not $verify.token -or $verify.record.is_admin -ne $true) { throw 'Der erste App-Administrator konnte nicht verifiziert werden.' }
    Write-Output 'Einrichtung abgeschlossen. Starten Sie die Anwendung mit scripts/windows/start.ps1.'
} finally {
    $plainSuperuser = $null
    $plainAdmin = $null
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; Wait-Process -Id $process.Id -Timeout 5 -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue }
}

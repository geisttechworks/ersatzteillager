param(
    [Parameter(Mandatory = $true)][string]$AdminEmail,
    [Parameter(Mandatory = $true)][string]$AdminName,
    [Parameter(Mandatory = $true)][Security.SecureString]$AdminPassword,
    [string]$InstallRoot,
    [string]$DataRoot
)

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $InstallRoot) { $InstallRoot = Get-InstallerRoot }
if (-not $DataRoot) { $DataRoot = Get-ApplicationDataRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
Assert-SafeApplicationDirectory $DataRoot

if ($AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Bitte eine gültige E-Mail-Adresse eingeben.' }
if ([string]::IsNullOrWhiteSpace($AdminName)) { throw 'Bitte einen Anzeigenamen eingeben.' }

$plainAdminPassword = Convert-SecureStringToPlainText $AdminPassword
if ($plainAdminPassword.Length -lt 12) { throw 'Das Passwort muss mindestens 12 Zeichen lang sein.' }

$binary = Join-Path $InstallRoot 'bin\pocketbase.exe'
$migrationDir = Join-Path $InstallRoot 'pb_migrations'
$publicDir = Join-Path $InstallRoot 'pb_public'
$dataDir = Join-Path $DataRoot 'pb_data'
$markerFile = Join-Path $DataRoot 'setup-complete.json'
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('ersatzteillager-einrichtung-' + [guid]::NewGuid().ToString('N'))
$bootstrapEmail = 'bootstrap-' + [guid]::NewGuid().ToString('N') + '@example.invalid'
$bootstrapPassword = New-BootstrapPassword
$temporaryPort = 18090 + (Get-Random -Minimum 0 -Maximum 500)
$process = $null
$bootstrapCreated = $false

try {
    if (Test-Path -LiteralPath $markerFile) { throw 'Die Anwendung wurde bereits eingerichtet.' }
    foreach ($required in @($binary, $migrationDir, $publicDir)) {
        if (-not (Test-Path -LiteralPath $required)) { throw "Installationsbestandteil fehlt: $required" }
    }
    New-Item -ItemType Directory -Path $DataRoot, $dataDir, $tempDir -Force | Out-Null

    $commonArguments = @(
        "--dir=$dataDir",
        "--migrationsDir=$migrationDir",
        "--publicDir=$publicDir"
    )
    & $binary @commonArguments superuser upsert $bootstrapEmail $bootstrapPassword *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Datenbank und Migrationen konnten nicht eingerichtet werden.' }
    $bootstrapCreated = $true

    $serveArguments = @(
        '--dir', ('"{0}"' -f $dataDir),
        '--migrationsDir', ('"{0}"' -f $migrationDir),
        '--publicDir', ('"{0}"' -f $publicDir),
        'serve',
        "--http=127.0.0.1:$temporaryPort",
        '--origins=http://127.0.0.1'
    )
    $process = Start-Process -FilePath $binary -ArgumentList $serveArguments -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $tempDir 'pocketbase.log') `
        -RedirectStandardError (Join-Path $tempDir 'pocketbase-error.log')
    $baseUri = "http://127.0.0.1:$temporaryPort"
    if (-not (Wait-HttpEndpoint "$baseUri/api/health" 40)) {
        throw 'Die lokale Datenbank wurde bei der Einrichtung nicht erreichbar.'
    }

    $authBody = @{ identity = $bootstrapEmail; password = $bootstrapPassword } | ConvertTo-Json
    $auth = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/_superusers/auth-with-password" `
        -ContentType 'application/json' -Body $authBody
    if (-not $auth.token) { throw 'Die abgesicherte Ersteinrichtung ist fehlgeschlagen.' }

    $adminBody = @{
        email = $AdminEmail.Trim()
        name = $AdminName.Trim()
        password = $plainAdminPassword
        passwordConfirm = $plainAdminPassword
        emailVisibility = $true
        is_admin = $true
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/users/records" `
        -Headers @{ Authorization = $auth.token } -ContentType 'application/json' -Body $adminBody | Out-Null

    $verifyBody = @{ identity = $AdminEmail.Trim(); password = $plainAdminPassword } | ConvertTo-Json
    $verify = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/users/auth-with-password" `
        -ContentType 'application/json' -Body $verifyBody
    if (-not $verify.token -or $verify.record.is_admin -ne $true) {
        throw 'Der erste Administrator konnte nicht verifiziert werden.'
    }

    [ordered]@{
        configuredAt = [DateTime]::UtcNow.ToString('o')
        schema = 'factory-v1'
    } | ConvertTo-Json | Set-Content -LiteralPath $markerFile -Encoding UTF8
} finally {
    $plainAdminPassword = $null
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        try { Wait-Process -Id $process.Id -Timeout 8 -ErrorAction Stop } catch {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($bootstrapCreated) {
        $commonArguments = @(
            "--dir=$dataDir",
            "--migrationsDir=$migrationDir",
            "--publicDir=$publicDir"
        )
        & $binary @commonArguments superuser delete $bootstrapEmail *> $null
    }
    $bootstrapPassword = $null
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

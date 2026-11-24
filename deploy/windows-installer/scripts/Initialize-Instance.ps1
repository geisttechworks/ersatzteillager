param(
    [string]$AdminEmail,
    [string]$AdminName,
    [Security.SecureString]$AdminPassword,
    [switch]$RepairBootstrap,
    [string]$InstallRoot,
    [string]$DataRoot
)

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $InstallRoot) { $InstallRoot = Get-InstallerRoot }
if (-not $DataRoot) { $DataRoot = Get-ApplicationDataRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
Assert-SafeApplicationDirectory $DataRoot

if (-not $RepairBootstrap) {
    if ($AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Bitte eine gültige E-Mail-Adresse eingeben.' }
    if ([string]::IsNullOrWhiteSpace($AdminName)) { throw 'Bitte einen Anzeigenamen eingeben.' }
    if (-not $AdminPassword -or $AdminPassword.Length -lt 12) { throw 'Das Passwort muss mindestens 12 Zeichen lang sein.' }
    $plainAdminPassword = Convert-SecureStringToPlainText $AdminPassword
}

$binary = Join-Path $InstallRoot 'bin\pocketbase.exe'
$migrationDir = Join-Path $InstallRoot 'pb_migrations'
$publicDir = Join-Path $InstallRoot 'pb_public'
$dataDir = Join-Path $DataRoot 'pb_data'
$markerFile = Join-Path $DataRoot 'setup-complete.json'
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('ersatzteillager-einrichtung-' + [guid]::NewGuid().ToString('N'))
$bootstrapEmail = 'bootstrap-' + [guid]::NewGuid().ToString('N') + '@example.invalid'
$bootstrapPassword = New-BootstrapPassword
$recoveryPassword = $null
$process = $null
$bootstrapCreated = $false
$recoveryReady = $false
$bootstrapDeleteFailed = $false

function Get-FreeLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function Invoke-SuperuserList([string]$BaseUri, [string]$Token) {
    $response = Invoke-RestMethod -Method Get -Uri "$BaseUri/api/collections/_superusers/records?perPage=200" `
        -Headers @{ Authorization = $Token }
    return @($response.items)
}

try {
    $markerExists = Test-Path -LiteralPath $markerFile -PathType Leaf
    if ($RepairBootstrap) {
        if (-not $markerExists -or -not (Test-Path -LiteralPath (Join-Path $dataDir 'data.db') -PathType Leaf)) {
            throw 'Die vorhandene Einrichtung konnte nicht zur Wiederherstellung geöffnet werden.'
        }
        $existingMarker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
        if ($existingMarker.bootstrapCleaned -eq $true) { return }
    } elseif ($markerExists) {
        throw 'Die Anwendung wurde bereits eingerichtet.'
    }
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

    $temporaryPort = Get-FreeLoopbackPort
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

    # PocketBase lässt den letzten Superuser nicht löschen. Deshalb bleibt genau ein
    # Recovery-Konto mit einem starken, sofort verworfenen Zufallspasswort bestehen.
    # Bei Bedarf ersetzt der Betreiber es später mit "pocketbase superuser upsert".
    $superusers = @(Invoke-SuperuserList $baseUri $auth.token)
    $recovery = $superusers | Where-Object { $_.email -match '^recovery-[a-f0-9]+@example\.invalid$' } | Select-Object -First 1
    if (-not $recovery) {
        $recoveryEmail = 'recovery-' + [guid]::NewGuid().ToString('N') + '@example.invalid'
        $recoveryPassword = New-BootstrapPassword
        $recoveryBody = @{
            email = $recoveryEmail
            password = $recoveryPassword
            passwordConfirm = $recoveryPassword
        } | ConvertTo-Json
        $recovery = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/_superusers/records" `
            -Headers @{ Authorization = $auth.token } -ContentType 'application/json' -Body $recoveryBody
        if (-not $recovery.id) { throw 'Das lokale Wiederherstellungskonto konnte nicht abgesichert werden.' }
    }
    $recoveryReady = $true
    $recoveryPassword = $null

    # Reste abgebrochener Läufe werden jetzt sicher entfernt. Der aktuelle Bootstrap-
    # Zugang bleibt bis zum Prozessende bestehen und wird anschließend per CLI gelöscht.
    $superusers = @(Invoke-SuperuserList $baseUri $auth.token)
    foreach ($oldBootstrap in ($superusers | Where-Object {
        $_.email -match '^bootstrap-[a-f0-9]{32}@example\.invalid$' -and $_.email -ne $bootstrapEmail
    })) {
        Invoke-RestMethod -Method Delete -Uri "$baseUri/api/collections/_superusers/records/$($oldBootstrap.id)" `
            -Headers @{ Authorization = $auth.token } | Out-Null
    }

    if (-not $RepairBootstrap) {
        $verifyBody = @{ identity = $AdminEmail.Trim(); password = $plainAdminPassword } | ConvertTo-Json
        $verify = $null
        try {
            $verify = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/users/auth-with-password" `
                -ContentType 'application/json' -Body $verifyBody -TimeoutSec 10
        } catch {
            if (-not $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 400) { throw }
        }

        if (-not $verify.token) {
            $adminBody = @{
                email = $AdminEmail.Trim()
                name = $AdminName.Trim()
                password = $plainAdminPassword
                passwordConfirm = $plainAdminPassword
                emailVisibility = $true
                is_admin = $true
            } | ConvertTo-Json
            try {
                Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/users/records" `
                    -Headers @{ Authorization = $auth.token } -ContentType 'application/json' -Body $adminBody -TimeoutSec 10 | Out-Null
            } catch {
                throw 'Der App-Administrator konnte nicht angelegt werden. Falls das Konto bereits besteht, verwenden Sie dieselben Zugangsdaten.'
            }
            $verify = Invoke-RestMethod -Method Post -Uri "$baseUri/api/collections/users/auth-with-password" `
                -ContentType 'application/json' -Body $verifyBody -TimeoutSec 10
        }
        if (-not $verify.token -or $verify.record.is_admin -ne $true) {
            throw 'Der erste Administrator konnte nicht verifiziert werden.'
        }
    }
} finally {
    $plainAdminPassword = $null
    $recoveryPassword = $null
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        try { Wait-Process -Id $process.Id -Timeout 8 -ErrorAction Stop } catch {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($bootstrapCreated -and $recoveryReady) {
        $commonArguments = @(
            "--dir=$dataDir",
            "--migrationsDir=$migrationDir",
            "--publicDir=$publicDir"
        )
        & $binary @commonArguments superuser delete $bootstrapEmail *> $null
        if ($LASTEXITCODE -ne 0) { $bootstrapDeleteFailed = $true }
    }
    $bootstrapPassword = $null
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($bootstrapDeleteFailed) {
    throw 'Der temporäre Einrichtungszugang konnte nicht entfernt werden. Starten Sie die Einrichtung erneut.'
}

$marker = if ($existingMarker) { $existingMarker } else {
    [pscustomobject]@{ configuredAt = [DateTime]::UtcNow.ToString('o'); schema = 'factory-v1' }
}
$marker | Add-Member -NotePropertyName bootstrapCleaned -NotePropertyValue $true -Force
$pendingMarker = $markerFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
try {
    $marker | ConvertTo-Json | Set-Content -LiteralPath $pendingMarker -Encoding UTF8
    if ($existingMarker) { [IO.File]::Replace($pendingMarker, $markerFile, [NullString]::Value) }
    else { [IO.File]::Move($pendingMarker, $markerFile) }
} finally {
    if (Test-Path -LiteralPath $pendingMarker) { Remove-Item -LiteralPath $pendingMarker -Force }
}

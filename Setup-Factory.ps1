param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$PocketBaseVersion,

    [Parameter(Mandatory = $true)]
    [uri]$PocketBaseDownloadRoot,

    [string]$ListenHost = '127.0.0.1',
    [ValidateRange(1, 65535)]
    [int]$PocketBasePort = 8090,

    [string]$SuperuserEmail,
    [securestring]$SuperuserPassword,
    [string]$AdminEmail,
    [string]$AdminName,
    [securestring]$AdminPassword,

    [switch]$SkipNodeInstall,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$toolsDir = Join-Path $projectRoot 'tools'
$pocketBaseExe = Join-Path $toolsDir 'pocketbase.exe'
$dataDir = Join-Path $projectRoot 'pb_data'
$migrationsDir = Join-Path $projectRoot 'pb_migrations'
$publicDir = Join-Path $projectRoot 'pb_public'
$tempRoot = [IO.Path]::GetTempPath()
$setupTemp = Join-Path $tempRoot ('ersatzteillager-setup-' + [guid]::NewGuid().ToString('N'))
$resolvedTemp = $null
$serverProcess = $null
$plainSuperuserPassword = $null
$plainAdminPassword = $null
$stage = 'Vorbereitung'

function Convert-ToPlainText([securestring]$Value) {
    return [Net.NetworkCredential]::new('', $Value).Password
}

function Read-ConfirmedPassword([string]$Prompt) {
    while ($true) {
        $first = Read-Host $Prompt -AsSecureString
        $second = Read-Host 'Passwort wiederholen' -AsSecureString
        $firstPlain = Convert-ToPlainText $first
        $secondPlain = Convert-ToPlainText $second
        if ($firstPlain.Length -lt 12) {
            Write-Host 'Das Passwort muss mindestens 12 Zeichen lang sein.' -ForegroundColor Yellow
            continue
        }
        if ($firstPlain -ne $secondPlain) {
            Write-Host 'Die Passwörter stimmen nicht überein.' -ForegroundColor Yellow
            continue
        }
        return $first
    }
}

function Assert-Email([string]$Value, [string]$Label) {
    if ($Value -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        throw "$Label ist keine gültige E-Mail-Adresse."
    }
}

function New-LoopbackUri([string]$Path = '/') {
    $builder = [UriBuilder]::new('http', $ListenHost, $PocketBasePort, $Path)
    return $builder.Uri
}

try {
    New-Item -ItemType Directory -Path $setupTemp, $toolsDir, $publicDir -Force | Out-Null
    $resolvedTemp = (Resolve-Path -LiteralPath $setupTemp).Path
    if (-not $resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Unsicherer temporärer Setup-Pfad.'
    }

    $installedVersionMatches = $false
    if (Test-Path -LiteralPath $pocketBaseExe) {
        $versionOutput = (& $pocketBaseExe --version 2>$null | Out-String)
        $installedVersionMatches = $versionOutput -match [regex]::Escape("version $PocketBaseVersion")
    }
    if (-not $installedVersionMatches) {
        $stage = 'PocketBase herunterladen und Prüfsumme kontrollieren'
        $releaseBase = [uri]::new($PocketBaseDownloadRoot, "v$PocketBaseVersion/")
        $archiveName = "pocketbase_${PocketBaseVersion}_windows_amd64.zip"
        $archiveUri = [uri]::new($releaseBase, $archiveName)
        $checksumsUri = [uri]::new($releaseBase, 'checksums.txt')
        $archivePath = Join-Path $resolvedTemp $archiveName
        $checksumsPath = Join-Path $resolvedTemp 'checksums.txt'

        Write-Host "PocketBase $PocketBaseVersion wird heruntergeladen und geprüft …"
        Invoke-WebRequest -Uri $archiveUri -OutFile $archivePath -UseBasicParsing
        Invoke-WebRequest -Uri $checksumsUri -OutFile $checksumsPath -UseBasicParsing
        $checksumLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s$([regex]::Escape($archiveName))$" } | Select-Object -First 1
        if (-not $checksumLine) { throw 'Für das PocketBase-Archiv wurde keine Prüfsumme gefunden.' }
        $expectedHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
        $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actualHash -ne $expectedHash) { throw 'Die SHA-256-Prüfsumme des PocketBase-Archivs stimmt nicht.' }

        Expand-Archive -LiteralPath $archivePath -DestinationPath $resolvedTemp -Force
        Copy-Item -LiteralPath (Join-Path $resolvedTemp 'pocketbase.exe') -Destination $pocketBaseExe -Force
    }

    if (-not $SkipNodeInstall) {
        $stage = 'Node-Abhängigkeiten installieren'
        Write-Host 'Node-Abhängigkeiten werden reproduzierbar installiert …'
        npm ci --prefix $projectRoot
        if ($LASTEXITCODE -ne 0) { throw 'npm ci ist fehlgeschlagen.' }
    }

    $stage = 'Zugangsdaten validieren'
    if (-not $SuperuserEmail) { $SuperuserEmail = Read-Host 'E-Mail des PocketBase-Superusers' }
    Assert-Email $SuperuserEmail 'Superuser-E-Mail'
    if (-not $SuperuserPassword) { $SuperuserPassword = Read-ConfirmedPassword 'Passwort des PocketBase-Superusers' }
    $plainSuperuserPassword = Convert-ToPlainText $SuperuserPassword
    if ($plainSuperuserPassword.Length -lt 12) { throw 'Das Superuser-Passwort muss mindestens 12 Zeichen lang sein.' }

    if (-not $AdminEmail) { $AdminEmail = Read-Host 'E-Mail des ersten App-Administrators' }
    Assert-Email $AdminEmail 'Admin-E-Mail'
    if (-not $AdminName) { $AdminName = Read-Host 'Anzeigename des ersten App-Administrators' }
    if ([string]::IsNullOrWhiteSpace($AdminName)) { throw 'Der Admin-Anzeigename darf nicht leer sein.' }
    if (-not $AdminPassword) { $AdminPassword = Read-ConfirmedPassword 'Passwort des ersten App-Administrators' }
    $plainAdminPassword = Convert-ToPlainText $AdminPassword
    if ($plainAdminPassword.Length -lt 12) { throw 'Das Admin-Passwort muss mindestens 12 Zeichen lang sein.' }

    $stage = 'Migrationen und Superuser einrichten'
    & $pocketBaseExe --dir $dataDir --migrationsDir $migrationsDir --publicDir $publicDir superuser upsert $SuperuserEmail $plainSuperuserPassword *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Superuser oder Migrationen konnten nicht eingerichtet werden.' }

    $stage = 'temporäre PocketBase-Instanz starten'
    $stdoutPath = Join-Path $resolvedTemp 'pocketbase.stdout.log'
    $stderrPath = Join-Path $resolvedTemp 'pocketbase.stderr.log'
    $arguments = '--dir "' + $dataDir + '" --migrationsDir "' + $migrationsDir + '" --publicDir "' + $publicDir + '" serve --http=' + $ListenHost + ':' + $PocketBasePort
    $serverProcess = Start-Process -FilePath $pocketBaseExe -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath

    $healthUri = New-LoopbackUri '/api/health'
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            Invoke-RestMethod -Uri $healthUri -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        } catch {
            if ($serverProcess.HasExited) { break }
        }
    }
    if (-not $ready) { throw 'Die lokale PocketBase-Instanz wurde nicht erreichbar.' }

    $stage = 'Superuser authentisieren'
    $superuserAuthUri = New-LoopbackUri '/api/collections/_superusers/auth-with-password'
    $authBody = @{ identity = $SuperuserEmail; password = $plainSuperuserPassword } | ConvertTo-Json
    $superuserAuth = Invoke-RestMethod -Method Post -Uri $superuserAuthUri -ContentType 'application/json' -Body $authBody
    $headers = @{ Authorization = $superuserAuth.token }

    $stage = 'ersten App-Administrator anlegen'
    $usersUri = New-LoopbackUri '/api/collections/users/records'
    $adminBody = @{
        email = $AdminEmail
        name = $AdminName
        password = $plainAdminPassword
        passwordConfirm = $plainAdminPassword
        emailVisibility = $true
        is_admin = $true
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri $usersUri -Headers $headers -ContentType 'application/json' -Body $adminBody | Out-Null

    $stage = 'App-Administrator verifizieren'
    $adminAuthUri = New-LoopbackUri '/api/collections/users/auth-with-password'
    $adminAuthBody = @{ identity = $AdminEmail; password = $plainAdminPassword } | ConvertTo-Json
    $adminAuth = Invoke-RestMethod -Method Post -Uri $adminAuthUri -ContentType 'application/json' -Body $adminAuthBody
    if (-not $adminAuth.token -or $adminAuth.record.is_admin -ne $true) { throw 'Der erste App-Administrator konnte nicht verifiziert werden.' }

    $developmentApi = (New-LoopbackUri '/').GetLeftPart([UriPartial]::Authority)
    Set-Content -LiteralPath (Join-Path $projectRoot '.env.local') -Value "VITE_POCKETBASE_URL=$developmentApi" -Encoding utf8

    if (-not $SkipBuild) {
        $stage = 'Produktions-Build erzeugen'
        & (Join-Path $projectRoot 'Build-Production.ps1')
        if ($LASTEXITCODE -ne 0) { throw 'Der Produktions-Build ist fehlgeschlagen.' }
    }

    Write-Host 'Factory-Setup abgeschlossen: Schema, Superuser, erster App-Admin und Build sind eingerichtet.' -ForegroundColor Green
} catch {
    Write-Error "Factory-Setup fehlgeschlagen während: $stage. Es wurden keine Zugangsdaten ausgegeben. Prüfe Netzwerk, Parameter und lokale Voraussetzungen."
    exit 1
} finally {
    $plainSuperuserPassword = $null
    $plainAdminPassword = $null
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($resolvedTemp -and $resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTemp)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

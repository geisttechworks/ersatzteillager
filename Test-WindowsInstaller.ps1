param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '1.0.1'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$outputRoot = Join-Path $projectRoot 'output\windows-installer'
$installRoot = Join-Path $outputRoot 'staging'
$testParent = Join-Path $outputRoot 'test-runs'
$testRoot = Join-Path $testParent ('run-' + [guid]::NewGuid().ToString('N'))
$backupRoot = Join-Path $testRoot 'external-backup'
$installer = Join-Path $outputRoot "Ersatzteillager-Setup-$Version.exe"
$checksumFile = $installer + '.sha256'
$email = 'admin@lager.example'
$plainPassword = 'Aa1!' + [guid]::NewGuid().ToString('N')
$securePassword = ConvertTo-SecureString $plainPassword -AsPlainText -Force
$portOffset = Get-Random -Minimum 0 -Maximum 300
$pbPort = 18100 + $portOffset
$setupPort = 19100 + $portOffset
$httpsPort = 20100 + $portOffset
$started = $false

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

try {
    foreach ($required in @($installRoot, $installer, $checksumFile)) {
        Assert-Condition (Test-Path -LiteralPath $required) "Installer-Artefakt fehlt: $required"
    }
    New-Item -ItemType Directory -Path $testRoot, $backupRoot -Force | Out-Null

    $expectedInstallerHash = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0]
    $actualInstallerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Condition ($actualInstallerHash -eq $expectedInstallerHash) 'Externe Installer-Prüfsumme stimmt nicht.'
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $installRoot 'pb_data'))) 'Das Paket enthält unerwartet Laufzeitdaten.'
    $installationGuide = Get-Content -LiteralPath (Join-Path $installRoot 'README-INSTALLATION.md') -Raw
    Assert-Condition ($installationGuide -match 'Get-FileHash') 'Die Anleitung enthält keinen Befehl zur Prüfsummenkontrolle.'
    Assert-Condition ($installationGuide -notmatch 'verteilterstellende') 'Die Anleitung enthält den früheren Tippfehler.'
    Assert-Condition ($installationGuide -match 'gehört immer zu einem bestimmten Windows-Konto') 'Der kontobezogene Datenordner ist nicht dokumentiert.'
    Assert-Condition ($installationGuide -match 'PolyForm Noncommercial License 1\.0\.0') 'Die Betreiberanleitung nennt die Projektlizenz nicht.'
    $projectLicense = Get-Content -LiteralPath (Join-Path $installRoot 'LICENSE.md') -Raw
    Assert-Condition ($projectLicense -match 'Required Notice: Copyright 2026 Wadim Geist / Geist Techworks') 'Required Notice fehlt in der Projektlizenz.'
    $thirdPartyLicenses = Get-Content -LiteralPath (Join-Path $installRoot 'licenses\THIRD-PARTY-LICENSES.md') -Raw
    Assert-Condition ($thirdPartyLicenses -match '246 eindeutige npm-Pakete') 'Das npm-Lizenzinventar fehlt oder ist unvollständig.'
    Assert-Condition ($thirdPartyLicenses -match 'Copyright \(c\) 2022 - present, Gani Georgiev') 'Der PocketBase-MIT-Hinweis fehlt.'

    & (Join-Path $installRoot 'scripts\Initialize-Instance.ps1') `
        -AdminEmail $email -AdminName 'Beispiel Administrator' -AdminPassword $securePassword `
        -InstallRoot $installRoot -DataRoot $testRoot
    Assert-Condition (Test-Path -LiteralPath (Join-Path $testRoot 'setup-complete.json')) 'Ersteinrichtung hat keine Abschlussmarkierung erzeugt.'

    & (Join-Path $installRoot 'scripts\Start-Ersatzteillager.ps1') `
        -InstallRoot $installRoot -DataRoot $testRoot -PocketBasePort $pbPort `
        -SetupPort $setupPort -HttpsPort $httpsPort -NoBrowser -SkipCertificateImport | Out-Null
    $started = $true
    $runtime = Get-Content -LiteralPath (Join-Path $testRoot 'run\runtime.json') -Raw | ConvertFrom-Json
    $setupResponse = Invoke-WebRequest -Uri $runtime.setupUrl -UseBasicParsing -TimeoutSec 5
    Assert-Condition ($setupResponse.StatusCode -eq 200) 'Einrichtungsseite antwortet nicht mit HTTP 200.'
    Assert-Condition ($setupResponse.Content -match 'Ersatzteillager einrichten') 'Einrichtungsseite enthält nicht den erwarteten Titel.'

    $healthJson = & curl.exe -k -sS ($runtime.appUrl + 'api/health')
    Assert-Condition ($LASTEXITCODE -eq 0) 'Lokaler HTTPS-Endpunkt ist nicht erreichbar.'
    $health = $healthJson | ConvertFrom-Json
    Assert-Condition ($health.code -eq 200) 'PocketBase-Healthcheck ist fehlgeschlagen.'

    $authBody = @{ identity = $email; password = $plainPassword } | ConvertTo-Json -Compress
    $authJson = & curl.exe -k -sS -H 'Content-Type: application/json' --data-raw $authBody `
        ($runtime.appUrl + 'api/collections/users/auth-with-password')
    $auth = $authJson | ConvertFrom-Json
    Assert-Condition ([bool]$auth.token) 'Login mit dem neu angelegten Administrator ist fehlgeschlagen.'

    $partBody = @{ name = 'Testlagerteil'; article_number = 'DEMO-0001'; quantity = 0; min_quantity = 0 } | ConvertTo-Json -Compress
    $partJson = & curl.exe -k -sS -H 'Content-Type: application/json' -H ('Authorization: ' + $auth.token) `
        --data-raw $partBody ($runtime.appUrl + 'api/collections/spare_parts/records')
    $part = $partJson | ConvertFrom-Json
    Assert-Condition ([bool]$part.id) 'Anlegen eines neutralen Testteils ist fehlgeschlagen.'

    $rootCertificate = Join-Path $testRoot 'caddy-data\caddy\pki\authorities\local\root.crt'
    Assert-Condition (Test-Path -LiteralPath $rootCertificate) 'Lokales Stammzertifikat fehlt.'
    $firstCertificateHash = (Get-FileHash -LiteralPath $rootCertificate -Algorithm SHA256).Hash
    $rootCertificateObject = [Security.Cryptography.X509Certificates.X509Certificate2]::new($rootCertificate)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $fingerprintBytes = $sha256.ComputeHash($rootCertificateObject.RawData)
    } finally {
        $sha256.Dispose()
    }
    $expectedFingerprint = ([BitConverter]::ToString($fingerprintBytes)).Replace('-', ':')
    $onboardingConfig = (Invoke-WebRequest -Uri ($runtime.setupUrl + 'config.js') -UseBasicParsing -TimeoutSec 5).Content
    Assert-Condition ($runtime.caSha256 -eq $expectedFingerprint) 'Laufzeitstatus enthält nicht den richtigen Zertifikatsfingerabdruck.'
    Assert-Condition ($onboardingConfig -match [regex]::Escape($expectedFingerprint)) 'Einrichtungsseite zeigt nicht den richtigen Zertifikatsfingerabdruck.'

    $backup = & (Join-Path $installRoot 'scripts\Backup-Ersatzteillager.ps1') `
        -DestinationDirectory $backupRoot -InstallRoot $installRoot -DataRoot $testRoot `
        -PocketBasePort $pbPort -SetupPort $setupPort -HttpsPort $httpsPort -SkipCertificateImport
    Assert-Condition (Test-Path -LiteralPath $backup) 'Externes ZIP-Backup wurde nicht erstellt.'
    Assert-Condition (Test-Path -LiteralPath ($backup + '.sha256')) 'Backup-Prüfsumme fehlt.'
    $healthAfterBackup = & curl.exe -k -sS ($runtime.appUrl + 'api/health') | ConvertFrom-Json
    Assert-Condition ($healthAfterBackup.code -eq 200) 'Anwendung wurde nach dem Backup nicht neu gestartet.'

    & (Join-Path $installRoot 'scripts\Stop-Ersatzteillager.ps1') -InstallRoot $installRoot -DataRoot $testRoot | Out-Null
    $started = $false
    & (Join-Path $installRoot 'scripts\Start-Ersatzteillager.ps1') `
        -InstallRoot $installRoot -DataRoot $testRoot -PocketBasePort $pbPort `
        -SetupPort $setupPort -HttpsPort $httpsPort -NoBrowser -SkipCertificateImport | Out-Null
    $started = $true
    $secondCertificateHash = (Get-FileHash -LiteralPath $rootCertificate -Algorithm SHA256).Hash
    Assert-Condition ($firstCertificateHash -eq $secondCertificateHash) 'Lokale Zertifizierungsstelle wurde beim Neustart unerwartet ersetzt.'

    [pscustomobject]@{
        InstallerChecksum = 'bestanden'
        FreshDatabase = 'bestanden'
        MigrationAndAdmin = 'bestanden'
        LocalSetupPage = 'bestanden'
        LocalHttps = 'bestanden'
        LoginAndPart = 'bestanden'
        BackupAndRestart = 'bestanden'
        CertificateReuse = 'bestanden'
        CertificateFingerprint = 'bestanden'
        OperatorGuide = 'bestanden'
    } | Format-List
} finally {
    $plainPassword = $null
    if ($started -and (Test-Path -LiteralPath $installRoot)) {
        & (Join-Path $installRoot 'scripts\Stop-Ersatzteillager.ps1') -InstallRoot $installRoot -DataRoot $testRoot 2>$null | Out-Null
    }
    if (Test-Path -LiteralPath $testRoot) {
        $testRootFull = [IO.Path]::GetFullPath($testRoot)
        $testParentFull = [IO.Path]::GetFullPath($testParent).TrimEnd('\') + '\'
        if ($testRootFull.StartsWith($testParentFull, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $testRootFull -Recurse -Force
        }
    }
}

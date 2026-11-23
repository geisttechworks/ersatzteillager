param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '1.0.1'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$outputRoot = Join-Path $projectRoot 'output\windows-installer'
$stagingRoot = Join-Path $outputRoot 'staging'
$cacheRoot = Join-Path $outputRoot 'cache'
$downloadRoot = Join-Path $cacheRoot 'downloads'
$expandRoot = Join-Path $cacheRoot 'expanded'
$onboardingOutput = Join-Path $stagingRoot 'onboarding'
$installerScript = Join-Path $projectRoot 'deploy\windows-installer\installer.iss'
$pocketBaseVersion = '0.40.6'
$pocketBaseArchive = "pocketbase_${pocketBaseVersion}_windows_amd64.zip"
$pocketBaseUrl = "https://github.com/pocketbase/pocketbase/releases/download/v$pocketBaseVersion/$pocketBaseArchive"
$pocketBaseHash = '33a2a1d255cadded77346fc7f5de37dca21ba4bad0d9cae0235a50b3b703d6d9'
$caddyVersion = '2.11.9'
$caddyArchive = "caddy_${caddyVersion}_windows_amd64.zip"
$caddyUrl = "https://github.com/caddyserver/caddy/releases/download/v$caddyVersion/$caddyArchive"
$caddyHash = 'ad93112d335ee687100c4c9f11bced16ca590377976b7fe7883882b9e797e472'

function Assert-ChildPath([string]$Parent, [string]$Child) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $childFull = [IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsicherer Ausgabepfad: $Child"
    }
}

function Get-VerifiedArchive([string]$Uri, [string]$Destination, [string]$ExpectedHash) {
    if (Test-Path -LiteralPath $Destination) {
        $current = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($current -ne $ExpectedHash) { Remove-Item -LiteralPath $Destination -Force }
    }
    if (-not (Test-Path -LiteralPath $Destination)) {
        Invoke-WebRequest -Uri $Uri -OutFile $Destination -UseBasicParsing
    }
    $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedHash) {
        throw "Prüfsumme des Downloads stimmt nicht: $([IO.Path]::GetFileName($Destination))"
    }
}

function Find-InnoCompiler {
    $candidates = @()
    try {
        $uninstall = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Inno Setup 6_is1' -ErrorAction Stop
        if ($uninstall.InstallLocation) { $candidates += (Join-Path $uninstall.InstallLocation 'ISCC.exe') }
    } catch {
        # Die Standardpfade werden anschließend geprüft.
    }
    if ($env:USERPROFILE) { $candidates += (Join-Path $env:USERPROFILE 'AppData\Local\Programs\Inno Setup 6\ISCC.exe') }
    $candidates += @(
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'Inno Setup 6 fehlt. Installiere es mit: winget install --id JRSoftware.InnoSetup --exact'
}

Assert-ChildPath $projectRoot $outputRoot
New-Item -ItemType Directory -Path $outputRoot, $cacheRoot, $downloadRoot -Force | Out-Null
if (Test-Path -LiteralPath $stagingRoot) {
    Assert-ChildPath $outputRoot $stagingRoot
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
if (Test-Path -LiteralPath $expandRoot) {
    Assert-ChildPath $outputRoot $expandRoot
    Remove-Item -LiteralPath $expandRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingRoot, $expandRoot -Force | Out-Null

npm run build --prefix $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Produktions-Build fehlgeschlagen.' }
npm run licenses --prefix $projectRoot
if ($LASTEXITCODE -ne 0) { throw 'Drittanbieter-Lizenzinventar konnte nicht erzeugt werden.' }

$previousOnboardingOutput = $env:ONBOARDING_OUT_DIR
try {
    $env:ONBOARDING_OUT_DIR = $onboardingOutput
    & (Join-Path $projectRoot 'node_modules\.bin\vite.cmd') build --config (Join-Path $projectRoot 'vite.onboarding.config.ts')
    if ($LASTEXITCODE -ne 0) { throw 'Build der Handy-Einrichtungsseite fehlgeschlagen.' }
} finally {
    $env:ONBOARDING_OUT_DIR = $previousOnboardingOutput
}

$pocketBaseZip = Join-Path $downloadRoot $pocketBaseArchive
$caddyZip = Join-Path $downloadRoot $caddyArchive
Get-VerifiedArchive $pocketBaseUrl $pocketBaseZip $pocketBaseHash
Get-VerifiedArchive $caddyUrl $caddyZip $caddyHash

$pocketBaseExpanded = Join-Path $expandRoot 'pocketbase'
$caddyExpanded = Join-Path $expandRoot 'caddy'
Expand-Archive -LiteralPath $pocketBaseZip -DestinationPath $pocketBaseExpanded -Force
Expand-Archive -LiteralPath $caddyZip -DestinationPath $caddyExpanded -Force

$binDir = New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'bin') -Force
$assetDir = New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'assets') -Force
$licenseDir = New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'licenses') -Force
Copy-Item -LiteralPath (Join-Path $pocketBaseExpanded 'pocketbase.exe') -Destination (Join-Path $binDir.FullName 'pocketbase.exe')
Copy-Item -LiteralPath (Join-Path $caddyExpanded 'caddy.exe') -Destination (Join-Path $binDir.FullName 'caddy.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'public\geist-techworks.png') -Destination (Join-Path $assetDir.FullName 'geist-techworks.png')

Copy-Item -Path (Join-Path $projectRoot 'dist\*') -Destination (New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'pb_public') -Force).FullName -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'pb_migrations') -Destination (Join-Path $stagingRoot 'pb_migrations') -Recurse
Copy-Item -Path (Join-Path $projectRoot 'deploy\windows-installer\scripts\*') -Destination (New-Item -ItemType Directory -Path (Join-Path $stagingRoot 'scripts') -Force).FullName -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\windows-installer\README-INSTALLATION.md') -Destination (Join-Path $stagingRoot 'README-INSTALLATION.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE.md') -Destination (Join-Path $stagingRoot 'LICENSE.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD-PARTY-LICENSES.md') -Destination (Join-Path $licenseDir.FullName 'THIRD-PARTY-LICENSES.md')

$pbLicense = Get-ChildItem -LiteralPath $pocketBaseExpanded -File | Where-Object { $_.Name -match '^LICENSE' } | Select-Object -First 1
$caddyLicense = Get-ChildItem -LiteralPath $caddyExpanded -File | Where-Object { $_.Name -match '^LICENSE' } | Select-Object -First 1
if ($pbLicense) { Copy-Item -LiteralPath $pbLicense.FullName -Destination (Join-Path $licenseDir.FullName 'PocketBase-LICENSE.txt') }
if ($caddyLicense) { Copy-Item -LiteralPath $caddyLicense.FullName -Destination (Join-Path $licenseDir.FullName 'Caddy-LICENSE.txt') }

@"
Ersatzteillager $Version
PocketBase $pocketBaseVersion
Caddy $caddyVersion
Build-Datum (UTC): $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))
"@ | Set-Content -LiteralPath (Join-Path $stagingRoot 'VERSION.txt') -Encoding UTF8

$checksums = Get-ChildItem -LiteralPath $stagingRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
    $relative = $_.FullName.Substring($stagingRoot.Length).TrimStart('\').Replace('\', '/')
    '{0}  {1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
}
Set-Content -LiteralPath (Join-Path $stagingRoot 'SHA256SUMS.txt') -Value $checksums -Encoding ASCII

$iscc = Find-InnoCompiler
& $iscc "/DSourceDir=$stagingRoot" "/DOutputDir=$outputRoot" "/DAppVersion=$Version" $installerScript
if ($LASTEXITCODE -ne 0) { throw 'Installer konnte nicht kompiliert werden.' }

$installer = Join-Path $outputRoot "Ersatzteillager-Setup-$Version.exe"
if (-not (Test-Path -LiteralPath $installer)) { throw 'Die erwartete Installationsdatei fehlt.' }
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumFile = $installer + '.sha256'
Set-Content -LiteralPath $checksumFile -Value "$installerHash  $([IO.Path]::GetFileName($installer))" -Encoding ASCII

$commercialLicensePresent = $false
try {
    $innoLicense = Get-ItemProperty 'HKCU:\Software\Jordan Russell\Inno Setup\License' -Name 'LicenseKey' -ErrorAction Stop
    $commercialLicensePresent = -not [string]::IsNullOrWhiteSpace([string]$innoLicense.LicenseKey)
} catch {
    # Es wird ausschließlich das Vorhandensein geprüft; ein Lizenzschlüssel wird nie ausgegeben.
}
if (-not $commercialLicensePresent) {
    Write-Warning 'Inno Setup wurde ohne hinterlegte kommerzielle Lizenz verwendet. Die Inno-Setup-Lizenz erlaubt kommerzielle Anwendungen, der Hersteller bittet kommerzielle Nutzer jedoch um den Kauf einer Lizenz. Vor betrieblicher Verteilung durch die zuständige Stelle prüfen.'
}

Write-Output "Installationsdatei: $installer"
Write-Output "Prüfsumme: $checksumFile"

param(
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version = '1.0.1'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$outputRoot = Join-Path $projectRoot 'output\windows-installer'
$testParent = Join-Path $outputRoot 'setup-tests'
$testRoot = Join-Path $testParent ('install-' + [guid]::NewGuid().ToString('N'))
$programRoot = Join-Path $testRoot 'program'
$installer = Join-Path $outputRoot "Ersatzteillager-Setup-$Version.exe"
$uninstaller = Join-Path $programRoot 'unins000.exe'
$setupLog = Join-Path $testRoot 'setup.log'

try {
    if (-not (Test-Path -LiteralPath $installer)) { throw 'Installationsdatei fehlt.' }
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    Write-Output 'Phase: EXE wird still in den isolierten Testordner installiert.'
    $arguments = @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER', '/AutomatedTest=1',
        ('/DIR="{0}"' -f $programRoot), ('/LOG="{0}"' -f $setupLog)
    )
    $setup = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
    if ($setup.ExitCode -ne 0) {
        $logHint = if (Test-Path -LiteralPath $setupLog) { ' Details stehen im isolierten setup.log.' } else { '' }
        throw "Installer-Test endete mit Code $($setup.ExitCode).$logHint"
    }

    Write-Output 'Phase: Installierte Pflichtdateien und Anleitung werden geprüft.'
    foreach ($relative in @(
        'bin\pocketbase.exe', 'bin\caddy.exe', 'pb_public\index.html',
        'pb_migrations\1800000000_factory_schema.js', 'scripts\First-Run.ps1',
        'onboarding\index.html', 'README-INSTALLATION.md', 'LICENSE.md',
        'licenses\THIRD-PARTY-LICENSES.md', 'licenses\PocketBase-LICENSE.txt',
        'licenses\Caddy-LICENSE.txt', 'SHA256SUMS.txt', 'unins000.exe'
    )) {
        if (-not (Test-Path -LiteralPath (Join-Path $programRoot $relative))) {
            throw "Installierter Bestandteil fehlt: $relative"
        }
    }
    if (Test-Path -LiteralPath (Join-Path $programRoot 'pb_data')) {
        throw 'Die Installationsdatei enthält unerwartet eine Datenbank.'
    }
    $installedGuide = Get-Content -LiteralPath (Join-Path $programRoot 'README-INSTALLATION.md') -Raw
    if ($installedGuide -notmatch 'Get-FileHash' -or $installedGuide -match 'verteilterstellende') {
        throw 'Die eingebettete Installationsanleitung ist nicht auf dem erwarteten Stand.'
    }
    $installedLicense = Get-Content -LiteralPath (Join-Path $programRoot 'LICENSE.md') -Raw
    if ($installedLicense -notmatch 'PolyForm Noncommercial License 1\.0\.0') {
        throw 'Die installierte Projektlizenz ist nicht PolyForm Noncommercial 1.0.0.'
    }
    $thirdParty = Get-Content -LiteralPath (Join-Path $programRoot 'licenses\THIRD-PARTY-LICENSES.md') -Raw
    if ($thirdParty -notmatch 'Copyright \(c\) 2022 - present, Gani Georgiev' -or $thirdParty -notmatch 'Caddy 2\.11\.9') {
        throw 'Das installierte Drittanbieter-Lizenzinventar ist unvollständig.'
    }

    Write-Output 'Phase: Testinstallation wird still deinstalliert.'
    $remove = Start-Process -FilePath $uninstaller -ArgumentList @(
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/AutomatedTest=1'
    ) -Wait -PassThru
    if ($remove.ExitCode -ne 0) { throw "Deinstallations-Test endete mit Code $($remove.ExitCode)." }

    [pscustomobject]@{
        SilentInstall = 'bestanden'
        RequiredFiles = 'bestanden'
        NoBundledDatabase = 'bestanden'
        EmbeddedGuide = 'bestanden'
        SilentUninstall = 'bestanden'
    } | Format-List
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        $testFull = [IO.Path]::GetFullPath($testRoot)
        $parentFull = [IO.Path]::GetFullPath($testParent).TrimEnd('\') + '\'
        if ($testFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $testFull -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

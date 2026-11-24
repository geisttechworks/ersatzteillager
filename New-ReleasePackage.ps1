param(
    [ValidatePattern('^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$')]
    [string]$ReleaseVersion = '1.0.2',
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$PocketBaseVersion = '0.40.6',
    [uri]$PocketBaseDownloadRoot = 'https://github.com/pocketbase/pocketbase/releases/download/'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$outputRoot = Join-Path $projectRoot 'output\release'
$pdfPath = Join-Path $projectRoot 'output\pdf\Anwender-Kurzanleitung-Mobil.pdf'
$tempRoot = Join-Path $outputRoot ('staging-' + [guid]::NewGuid().ToString('N'))
$packageName = "ersatzteillager-server-$ReleaseVersion-universal"
$packageRoot = Join-Path $tempRoot $packageName
$zipPath = Join-Path $outputRoot ($packageName + '.zip')
$checksumPath = $zipPath + '.sha256'

function Assert-ChildPath([string]$Parent, [string]$Child) {
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $childFull = [IO.Path]::GetFullPath($Child)
    if (-not $childFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsicherer Paketpfad: $Child" }
}

try {
    New-Item -ItemType Directory -Path $outputRoot, $packageRoot -Force | Out-Null
    Assert-ChildPath $outputRoot $tempRoot
    if (-not (Test-Path -LiteralPath $pdfPath)) { throw 'Die einseitige Anwender-PDF fehlt. Führe zuerst scripts/new_user_guide_pdf.py aus.' }

    npm run build --prefix $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Produktions-Build fehlgeschlagen.' }
    npm run licenses --prefix $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Drittanbieter-Lizenzinventar konnte nicht erzeugt werden.' }

    $releaseBase = [uri]::new($PocketBaseDownloadRoot, "v$PocketBaseVersion/")
    $checksumsPath = Join-Path $tempRoot 'upstream-checksums.txt'
    Invoke-WebRequest -Uri ([uri]::new($releaseBase, 'checksums.txt')) -OutFile $checksumsPath -UseBasicParsing
    $platforms = @(
        @{ Archive = "pocketbase_${PocketBaseVersion}_windows_amd64.zip"; Binary = 'pocketbase.exe'; Destination = 'bin\windows-amd64\pocketbase.exe' },
        @{ Archive = "pocketbase_${PocketBaseVersion}_linux_amd64.zip"; Binary = 'pocketbase'; Destination = 'bin\linux-amd64\pocketbase' }
    )
    foreach ($platform in $platforms) {
        $archivePath = Join-Path $tempRoot $platform.Archive
        Invoke-WebRequest -Uri ([uri]::new($releaseBase, $platform.Archive)) -OutFile $archivePath -UseBasicParsing
        $line = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s$([regex]::Escape($platform.Archive))$" } | Select-Object -First 1
        if (-not $line) { throw "Keine offizielle Prüfsumme für $($platform.Archive) gefunden." }
        $expected = ($line -split '\s+')[0].ToUpperInvariant()
        $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToUpperInvariant()
        if ($actual -ne $expected) { throw "Prüfsumme für $($platform.Archive) stimmt nicht." }
        $expanded = Join-Path $tempRoot ('expanded-' + [IO.Path]::GetFileNameWithoutExtension($platform.Archive))
        Expand-Archive -LiteralPath $archivePath -DestinationPath $expanded -Force
        $destination = Join-Path $packageRoot $platform.Destination
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $expanded $platform.Binary) -Destination $destination
    }

    Copy-Item -Path (Join-Path $projectRoot 'dist\*') -Destination (New-Item -ItemType Directory -Path (Join-Path $packageRoot 'pb_public') -Force).FullName -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'pb_migrations') -Destination (Join-Path $packageRoot 'pb_migrations') -Recurse
    $windowsScripts = New-Item -ItemType Directory -Path (Join-Path $packageRoot 'scripts\windows') -Force
    $linuxScripts = New-Item -ItemType Directory -Path (Join-Path $packageRoot 'scripts\linux') -Force
    $proxyDir = New-Item -ItemType Directory -Path (Join-Path $packageRoot 'reverse-proxy') -Force
    Copy-Item -Path (Join-Path $projectRoot 'deploy\windows\*') -Destination $windowsScripts.FullName -Recurse
    Copy-Item -Path (Join-Path $projectRoot 'deploy\linux\*') -Destination $linuxScripts.FullName -Recurse
    Copy-Item -Path (Join-Path $projectRoot 'deploy\reverse-proxy\*') -Destination $proxyDir.FullName -Recurse
    Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\.env.example') -Destination (Join-Path $packageRoot '.env.example')
    Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\README.md') -Destination (Join-Path $packageRoot 'README.md')
    $docsDir = New-Item -ItemType Directory -Path (Join-Path $packageRoot 'docs') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'deploy\IT-INSTALLATION.md') -Destination (Join-Path $docsDir.FullName 'IT-INSTALLATION.md')
    Copy-Item -LiteralPath (Join-Path $projectRoot 'ANWENDERANLEITUNG.md') -Destination (Join-Path $docsDir.FullName 'ANWENDERANLEITUNG.md')
    Copy-Item -LiteralPath $pdfPath -Destination (Join-Path $docsDir.FullName 'Anwender-Kurzanleitung-Mobil.pdf')
    Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE.md') -Destination (Join-Path $packageRoot 'LICENSE.md')
    $licensesDir = New-Item -ItemType Directory -Path (Join-Path $packageRoot 'licenses') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD-PARTY-LICENSES.md') -Destination (Join-Path $licensesDir.FullName 'THIRD-PARTY-LICENSES.md')
    Set-Content -LiteralPath (Join-Path $packageRoot 'VERSION.txt') -Value "Ersatzteillager $ReleaseVersion`nPocketBase $PocketBaseVersion" -Encoding utf8

    $checksumLines = Get-ChildItem -LiteralPath $packageRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($packageRoot, $_.FullName).Replace('\', '/')
        "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
    }
    Set-Content -LiteralPath (Join-Path $packageRoot 'SHA256SUMS.txt') -Value $checksumLines -Encoding ascii

    Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal -Force
    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $checksumPath -Value "$zipHash  $([IO.Path]::GetFileName($zipPath))" -Encoding ascii
    Write-Output "Serverpaket erstellt: $zipPath"
    Write-Output "Prüfsumme erstellt: $checksumPath"
} finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Assert-ChildPath $outputRoot $tempRoot
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}

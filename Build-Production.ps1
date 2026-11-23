$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$previousPocketBaseUrl = $env:VITE_POCKETBASE_URL

try {
    # The static production build is served by PocketBase itself, so use its own origin.
    $env:VITE_POCKETBASE_URL = ''
    npm run build --prefix $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Produktions-Build fehlgeschlagen.' }

    $destination = Join-Path $projectRoot 'pb_public'
    if (Test-Path -LiteralPath $destination) {
        $resolvedDestination = [IO.Path]::GetFullPath($destination)
        $resolvedProjectRoot = [IO.Path]::GetFullPath($projectRoot)
        if (-not $resolvedDestination.StartsWith($resolvedProjectRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedDestination) -ne 'pb_public') {
            throw 'Unsicherer pb_public-Zielpfad.'
        }
        Remove-Item -LiteralPath $resolvedDestination -Recurse -Force
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $projectRoot 'dist\*') -Destination $destination -Recurse -Force
    Write-Output 'Build nach pb_public kopiert.'
} finally {
    $env:VITE_POCKETBASE_URL = $previousPocketBaseUrl
}

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$previousBrowserPath = $env:PLAYWRIGHT_BROWSERS_PATH

try {
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.playwright-browsers'
    Push-Location $projectRoot
    try {
        npx playwright install chromium webkit
        if ($LASTEXITCODE -ne 0) { throw 'Playwright-Browser konnten nicht installiert werden.' }
    } finally {
        Pop-Location
    }
    Write-Output 'Playwright-Browser wurden lokal und reproduzierbar installiert.'
} finally {
    $env:PLAYWRIGHT_BROWSERS_PATH = $previousBrowserPath
}

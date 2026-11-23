param([string]$Grep = '')

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$tempRoot = [System.IO.Path]::GetTempPath()
$testDir = Join-Path $tempRoot ('.ersatzteillager-e2e-' + [guid]::NewGuid().ToString('N'))
$publicDir = Join-Path $projectRoot 'pb_public'
$resolvedTestDir = $null
$pocketBaseProcess = $null
$oldUrl = $env:VITE_POCKETBASE_URL
$oldEmail = $env:E2E_EMAIL
$oldPassword = $env:E2E_PASSWORD
$oldAppUrl = $env:E2E_APP_URL
$oldAppPort = $env:E2E_APP_PORT
$oldPlaywrightBrowsersPath = $env:PLAYWRIGHT_BROWSERS_PATH
$oldSkipWebServer = $env:E2E_SKIP_WEB_SERVER
$oldGrep = $env:E2E_GREP
$pbPort = 0
$stage = 'temporäre Testinstanz vorbereiten'

function Get-FreeLoopbackPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

try {
    New-Item -ItemType Directory -Path $testDir -Force | Out-Null
    $pbPort = Get-FreeLoopbackPort
    $resolvedTestDir = (Resolve-Path -LiteralPath $testDir).Path
    if (-not $resolvedTestDir.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Unsicherer Testdatenpfad.'
    }

    $stage = 'Produktions-Build nach pb_public erstellen'
    & (Join-Path $projectRoot 'Build-Production.ps1')
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $publicDir 'index.html'))) {
        throw 'Der Produktions-Build in pb_public konnte nicht erstellt werden.'
    }

    $testEmail = 'e2e-' + [guid]::NewGuid().ToString('N') + '@example.invalid'
    $testPassword = [guid]::NewGuid().ToString('N') + 'Aa1!'
    $pocketBase = Join-Path $projectRoot 'tools\pocketbase.exe'
    if (-not (Test-Path -LiteralPath $pocketBase)) {
        throw 'PocketBase fehlt. Führe zuerst Setup-Factory.ps1 gemäß README aus.'
    }
    $migrationsDir = Join-Path $projectRoot 'pb_migrations'

    $stage = 'PocketBase-Migrationen anwenden'
    & $pocketBase --dir $resolvedTestDir --migrationsDir $migrationsDir --publicDir $publicDir superuser upsert $testEmail $testPassword *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Isolierte PocketBase-Testinstanz konnte nicht initialisiert werden.' }

    $stage = 'isolierte PocketBase-Testinstanz starten'
    $pbArgs = '--dir "' + $resolvedTestDir + '" --migrationsDir "' + $migrationsDir + '" --publicDir "' + $publicDir + '" --indexFallback=true serve --http=127.0.0.1:' + $pbPort + ' --origins=http://127.0.0.1:' + $pbPort
    $pocketBaseProcess = Start-Process -FilePath $pocketBase -ArgumentList $pbArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $resolvedTestDir 'pb-out.log') -RedirectStandardError (Join-Path $resolvedTestDir 'pb-err.log')

    $healthy = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            Invoke-RestMethod -Uri ('http://127.0.0.1:' + $pbPort + '/api/health') -TimeoutSec 1 | Out-Null
            $healthy = $true
            break
        } catch {
            if ($pocketBaseProcess.HasExited) { break }
        }
    }
    if (-not $healthy) {
        $logPath = Join-Path $resolvedTestDir 'pb-err.log'
        $details = if (Test-Path -LiteralPath $logPath) {
            (Get-Content -LiteralPath $logPath -Raw).Replace($testEmail, '[email]').Replace($testPassword, '[redacted]') -replace '[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}', '[token]'
        } else { '' }
        $safeLines = $details -split "`n" | Where-Object { $_ -match 'error|failed|migration|listen|address already' } | Select-Object -Last 6
        throw ('PocketBase-Testinstanz wurde nicht erreichbar. ' + ($safeLines -join ' '))
    }

    $stage = 'Testadministrator für die App einrichten'
    $auth = Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:' + $pbPort + '/api/collections/_superusers/auth-with-password') -ContentType 'application/json' -Body (@{ identity = $testEmail; password = $testPassword } | ConvertTo-Json)
    $headers = @{ Authorization = $auth.token }
    $userBody = @{
        email = $testEmail
        password = $testPassword
        passwordConfirm = $testPassword
        name = 'E2E Test Admin'
        is_admin = $true
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:' + $pbPort + '/api/collections/users/records') -Headers $headers -ContentType 'application/json' -Body $userBody | Out-Null

    $env:VITE_POCKETBASE_URL = ''
    $env:E2E_EMAIL = $testEmail
    $env:E2E_PASSWORD = $testPassword
    $env:E2E_APP_URL = 'http://127.0.0.1:' + $pbPort
    $env:E2E_APP_PORT = [string]$pbPort
    $env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $projectRoot '.playwright-browsers'
    $env:E2E_SKIP_WEB_SERVER = 'true'
    $env:E2E_GREP = $Grep
    if (-not (Test-Path -LiteralPath $env:PLAYWRIGHT_BROWSERS_PATH)) {
        throw 'Playwright-Browser fehlen. Führe zuerst Install-TestBrowsers.ps1 aus.'
    }
    $stage = 'Playwright-Läufe gegen pb_public'
    npm run test:e2e --prefix $projectRoot
    if ($LASTEXITCODE -ne 0) { throw 'Playwright-Prüfung fehlgeschlagen.' }
} catch {
    $safeError = $_.Exception.Message
    if ($testEmail) { $safeError = $safeError.Replace($testEmail, '[email]') }
    if ($testPassword) { $safeError = $safeError.Replace($testPassword, '[redacted]') }
    $safeError = $safeError -replace '[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}', '[token]'
    Write-Error "E2E-Prüfung fehlgeschlagen während: $stage. $safeError"
    exit 1
} finally {
    $env:VITE_POCKETBASE_URL = $oldUrl
    $env:E2E_EMAIL = $oldEmail
    $env:E2E_PASSWORD = $oldPassword
    $env:E2E_APP_URL = $oldAppUrl
    $env:E2E_APP_PORT = $oldAppPort
    $env:PLAYWRIGHT_BROWSERS_PATH = $oldPlaywrightBrowsersPath
    $env:E2E_SKIP_WEB_SERVER = $oldSkipWebServer
    $env:E2E_GREP = $oldGrep
    if ($pocketBaseProcess -and -not $pocketBaseProcess.HasExited) {
        Stop-Process -Id $pocketBaseProcess.Id -Force -ErrorAction SilentlyContinue
        Wait-Process -Id $pocketBaseProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
    if ($resolvedTestDir -and $resolvedTestDir.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestDir)) {
        for ($cleanupAttempt = 0; $cleanupAttempt -lt 5; $cleanupAttempt++) {
            try {
                Remove-Item -LiteralPath $resolvedTestDir -Recurse -Force -ErrorAction Stop
                break
            } catch {
                if ($cleanupAttempt -eq 4) {
                    Write-Warning 'Der temporäre E2E-Ordner konnte wegen einer noch offenen Logdatei nicht sofort entfernt werden.'
                } else {
                    Start-Sleep -Milliseconds 300
                }
            }
        }
    }
}

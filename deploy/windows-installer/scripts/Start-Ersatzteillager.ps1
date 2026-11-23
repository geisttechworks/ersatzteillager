param(
    [string]$InstallRoot,
    [string]$DataRoot,
    [int]$PocketBasePort = 8090,
    [int]$SetupPort = 8080,
    [int]$HttpsPort = 8443,
    [switch]$NoBrowser,
    [switch]$SkipCertificateImport
)

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $InstallRoot) { $InstallRoot = Get-InstallerRoot }
if (-not $DataRoot) { $DataRoot = Get-ApplicationDataRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
Assert-SafeApplicationDirectory $DataRoot

$markerFile = Join-Path $DataRoot 'setup-complete.json'
if (-not (Test-Path -LiteralPath $markerFile)) {
    $firstRun = Join-Path $InstallRoot 'scripts\First-Run.ps1'
    if (-not (Test-Path -LiteralPath $firstRun)) { throw 'Das Einrichtungsprogramm fehlt.' }
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $firstRun)
    ) | Out-Null
    return
}

foreach ($port in @($PocketBasePort, $SetupPort, $HttpsPort)) {
    if ($port -lt 1 -or $port -gt 65535) { throw "Ungültiger Port: $port" }
}

$lanAddress = Get-LanIPv4
$setupUrl = "http://$lanAddress`:$SetupPort/"
$appUrl = "https://$lanAddress`:$HttpsPort/"
$origin = $appUrl.TrimEnd('/')
$pbBinary = Join-Path $InstallRoot 'bin\pocketbase.exe'
$caddyBinary = Join-Path $InstallRoot 'bin\caddy.exe'
$migrationDir = Join-Path $InstallRoot 'pb_migrations'
$publicDir = Join-Path $InstallRoot 'pb_public'
$onboardingSource = Join-Path $InstallRoot 'onboarding'
$dataDir = Join-Path $DataRoot 'pb_data'
$runDir = Join-Path $DataRoot 'run'
$logDir = Join-Path $DataRoot 'logs'
$caddyDataHome = Join-Path $DataRoot 'caddy-data'
$caddyConfigHome = Join-Path $DataRoot 'caddy-config'
$onboardingDir = Join-Path $DataRoot 'onboarding'
$pbControl = Join-Path $runDir 'pocketbase.json'
$caddyControl = Join-Path $runDir 'caddy.json'
$caddyFile = Join-Path $runDir 'Caddyfile'
$runtimeFile = Join-Path $runDir 'runtime.json'

foreach ($required in @($pbBinary, $caddyBinary, $migrationDir, $publicDir, $onboardingSource)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Installationsbestandteil fehlt: $required" }
}
New-Item -ItemType Directory -Path $dataDir, $runDir, $logDir, $caddyDataHome, $caddyConfigHome, $onboardingDir -Force | Out-Null

$existingPb = Get-ControlledProcess $pbControl $pbBinary
$existingCaddy = Get-ControlledProcess $caddyControl $caddyBinary
if ($existingPb -and $existingCaddy) {
    $existingRuntime = $null
    try { $existingRuntime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json } catch {
        # Ohne passenden Laufzeitstatus wird kontrolliert neu gestartet.
    }
    if ($existingRuntime -and [string]$existingRuntime.appUrl -eq $appUrl -and [string]$existingRuntime.setupUrl -eq $setupUrl) {
        if (-not $NoBrowser) { Start-Process $setupUrl | Out-Null }
        Write-Output "Ersatzteillager läuft bereits: $appUrl"
        return
    }
}

Stop-ControlledProcess $caddyControl $caddyBinary
Stop-ControlledProcess $pbControl $pbBinary

Copy-Item -Path (Join-Path $onboardingSource '*') -Destination $onboardingDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $InstallRoot 'assets\geist-techworks.png') -Destination (Join-Path $onboardingDir 'geist-techworks.png') -Force
$configScript = @"
window.ERSATZTEILLAGER_SETUP = {
  appUrl: '$appUrl',
  setupUrl: '$setupUrl',
  computerName: '$($env:COMPUTERNAME)',
  caFile: './ersatzteillager-wlan-ca.cer',
  caSha256: ''
};
"@
Set-Content -LiteralPath (Join-Path $onboardingDir 'config.js') -Value $configScript -Encoding UTF8

$pbArguments = @(
    ('--dir="{0}"' -f $dataDir),
    ('--migrationsDir="{0}"' -f $migrationDir),
    ('--publicDir="{0}"' -f $publicDir),
    '--indexFallback=true',
    'serve',
    "--http=127.0.0.1:$PocketBasePort",
    "--origins=$origin"
)
$pbProcess = Start-Process -FilePath $pbBinary -ArgumentList $pbArguments -WorkingDirectory $InstallRoot `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'pocketbase.log') `
    -RedirectStandardError (Join-Path $logDir 'pocketbase-error.log')
Write-ControlledProcess $pbProcess $pbBinary $pbControl
if (-not (Wait-HttpEndpoint "http://127.0.0.1:$PocketBasePort/api/health" 40)) {
    Stop-ControlledProcess $pbControl $pbBinary
    throw 'PocketBase konnte nicht gestartet werden. Details stehen im lokalen Protokollordner.'
}

$onboardingPath = Convert-ToCaddyPath $onboardingDir
$caddyText = @"
{
    admin off
    auto_https disable_redirects
    skip_install_trust
    pki {
        ca local {
            name "Ersatzteillager WLAN"
            root_cn "Ersatzteillager WLAN Stammzertifikat"
            intermediate_cn "Ersatzteillager WLAN Zwischenzertifikat"
        }
    }
}

http://$lanAddress`:$SetupPort {
    root * "$onboardingPath"
    file_server
}

https://$lanAddress`:$HttpsPort {
    tls internal
    reverse_proxy 127.0.0.1:$PocketBasePort
}
"@
Set-Content -LiteralPath $caddyFile -Value $caddyText -Encoding UTF8

$previousDataHome = $env:XDG_DATA_HOME
$previousConfigHome = $env:XDG_CONFIG_HOME
try {
    $env:XDG_DATA_HOME = $caddyDataHome
    $env:XDG_CONFIG_HOME = $caddyConfigHome
    $caddyArguments = @('run', '--config', ('"{0}"' -f $caddyFile), '--adapter', 'caddyfile')
    $caddyProcess = Start-Process -FilePath $caddyBinary -ArgumentList $caddyArguments -WorkingDirectory $InstallRoot `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'caddy.log') `
        -RedirectStandardError (Join-Path $logDir 'caddy-error.log')
} finally {
    $env:XDG_DATA_HOME = $previousDataHome
    $env:XDG_CONFIG_HOME = $previousConfigHome
}
Write-ControlledProcess $caddyProcess $caddyBinary $caddyControl

if (-not (Wait-HttpEndpoint $setupUrl 40)) {
    Stop-ControlledProcess $caddyControl $caddyBinary
    Stop-ControlledProcess $pbControl $pbBinary
    throw 'Die WLAN-Einrichtungsseite konnte nicht gestartet werden. Details stehen im lokalen Protokollordner.'
}
if (-not (Wait-HttpEndpoint ($appUrl + 'api/health') 40 -AllowUntrustedCertificate)) {
    Stop-ControlledProcess $caddyControl $caddyBinary
    Stop-ControlledProcess $pbControl $pbBinary
    throw 'Der lokale HTTPS-Zugang konnte nicht gestartet werden. Details stehen im lokalen Protokollordner.'
}

$rootCertificate = Join-Path $caddyDataHome 'caddy\pki\authorities\local\root.crt'
for ($attempt = 0; $attempt -lt 30 -and -not (Test-Path -LiteralPath $rootCertificate); $attempt++) {
    Start-Sleep -Milliseconds 300
}
if (-not (Test-Path -LiteralPath $rootCertificate)) {
    throw 'Das lokale WLAN-Zertifikat wurde nicht erzeugt.'
}

$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($rootCertificate)
$derPath = Join-Path $onboardingDir 'ersatzteillager-wlan-ca.cer'
[IO.File]::WriteAllBytes($derPath, $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert))
$sha256 = [Security.Cryptography.SHA256]::Create()
try {
    $fingerprintBytes = $sha256.ComputeHash($certificate.RawData)
} finally {
    $sha256.Dispose()
}
$caSha256 = ([BitConverter]::ToString($fingerprintBytes)).Replace('-', ':')
$configScript = @"
window.ERSATZTEILLAGER_SETUP = {
  appUrl: '$appUrl',
  setupUrl: '$setupUrl',
  computerName: '$($env:COMPUTERNAME)',
  caFile: './ersatzteillager-wlan-ca.cer',
  caSha256: '$caSha256'
};
"@
Set-Content -LiteralPath (Join-Path $onboardingDir 'config.js') -Value $configScript -Encoding UTF8
if (-not $SkipCertificateImport) {
    $existingCertificate = Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $certificate.Thumbprint } | Select-Object -First 1
    if (-not $existingCertificate) {
        Import-Certificate -FilePath $derPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
    }
}

[ordered]@{
    address = $lanAddress
    setupUrl = $setupUrl
    appUrl = $appUrl
    caSha256 = $caSha256
    startedAt = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile -Encoding UTF8

if (-not $NoBrowser) { Start-Process $setupUrl | Out-Null }
Write-Output "Ersatzteillager gestartet: $appUrl"
Write-Output "Handy-Einrichtung: $setupUrl"

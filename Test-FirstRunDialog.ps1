param(
    [Parameter(Mandatory = $true)][string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$testParent = Join-Path $projectRoot 'output\windows-installer\first-run-tests'
$testRoot = Join-Path $testParent ('run-' + [guid]::NewGuid().ToString('N'))
$timeoutRoot = Join-Path $testRoot 'timeout'
$dataRoot = Join-Path $testRoot 'complete'
$binary = Join-Path $InstallRoot 'bin\pocketbase.exe'
$firstRun = Join-Path $InstallRoot 'scripts\First-Run.ps1'
$stopScript = Join-Path $InstallRoot 'scripts\Stop-Ersatzteillager.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$adminEmail = 'admin@first-run.example.invalid'
$adminPassword = 'Aa1!' + [guid]::NewGuid().ToString('N')
$stalePassword = 'Aa1!' + [guid]::NewGuid().ToString('N')
$auditPassword = 'Aa1!' + [guid]::NewGuid().ToString('N')
$started = $false
$auditProcess = $null
$firstRunProcesses = New-Object Collections.Generic.List[Diagnostics.Process]

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Get-FreePorts([int]$Count) {
    $ports = New-Object Collections.Generic.List[int]
    while ($ports.Count -lt $Count) {
        $candidate = Get-Random -Minimum 22000 -Maximum 40000
        if ($candidate -in $ports) { continue }
        $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $candidate)
        try {
            $probe.Start()
            $ports.Add($candidate)
        } catch {
            # Der Kandidat ist belegt; ein anderer Port wird geprüft.
        } finally {
            $probe.Stop()
        }
    }
    return @($ports)
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-ProcessElements([int]$TargetProcessId) {
    $condition = New-Object Windows.Automation.PropertyCondition(
        [Windows.Automation.AutomationElement]::ProcessIdProperty, $TargetProcessId
    )
    return [Windows.Automation.AutomationElement]::RootElement.FindAll(
        [Windows.Automation.TreeScope]::Descendants, $condition
    )
}

function Wait-ProcessElement([int]$TargetProcessId, [string]$Name, [int]$TimeoutSeconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        foreach ($element in (Get-ProcessElements $TargetProcessId)) {
            if ($element.Current.Name -eq $Name -and
                $element.Current.ControlType -eq [Windows.Automation.ControlType]::Window) {
                return $element
            }
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Sichtbares Element wurde nicht gefunden: $Name"
}

function Get-NamedDescendant($Root, [string]$Name) {
    $condition = New-Object Windows.Automation.PropertyCondition(
        [Windows.Automation.AutomationElement]::NameProperty, $Name
    )
    $element = $Root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
    if (-not $element) { throw "Dialogelement fehlt: $Name" }
    return $element
}

function Set-AutomationValue($Root, [string]$Name, [string]$Value) {
    $nameCondition = New-Object Windows.Automation.PropertyCondition(
        [Windows.Automation.AutomationElement]::NameProperty, $Name
    )
    $typeCondition = New-Object Windows.Automation.PropertyCondition(
        [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit
    )
    $condition = [Windows.Automation.AndCondition]::new($nameCondition, $typeCondition)
    $element = $Root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
    if (-not $element) { throw "Eingabefeld fehlt: $Name" }
    $pattern = $element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    $pattern.SetValue($Value)
}

function Invoke-AutomationButton($Root, [string]$Name) {
    $element = Get-NamedDescendant $Root $Name
    $pattern = $element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
}

function Start-FirstRun([string]$TargetDataRoot, [int[]]$Ports, [int]$TimeoutSeconds) {
    $arguments = @(
        '-NoProfile', '-WindowStyle', 'Normal', '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $firstRun),
        '-InstallRoot', ('"{0}"' -f $InstallRoot),
        '-DataRoot', ('"{0}"' -f $TargetDataRoot),
        '-SetupPort', $Ports[0], '-PocketBasePort', $Ports[1], '-HttpsPort', $Ports[2],
        '-TimeoutSeconds', $TimeoutSeconds
    )
    $child = Start-Process -FilePath $powershell -ArgumentList $arguments -PassThru -WindowStyle Normal
    $firstRunProcesses.Add($child)
    return $child
}

function Wait-Http([string]$Uri, [int]$TimeoutSeconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    return $false
}

function Remove-TestRootCertificate([string]$CertificatePath) {
    if (-not (Test-Path -LiteralPath $CertificatePath)) { return }
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($CertificatePath)
    $cleanupScript = Join-Path $testRoot 'remove-test-certificate.ps1'
    @'
param([string]$Thumbprint)
$store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
try {
    $store.Open('ReadWrite')
    foreach ($certificate in @($store.Certificates | Where-Object Thumbprint -eq $Thumbprint)) {
        $store.Remove($certificate)
    }
} finally {
    $store.Close()
}
'@ | Set-Content -LiteralPath $cleanupScript -Encoding UTF8
    $cleanupArguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $cleanupScript),
        '-Thumbprint', $certificate.Thumbprint
    )
    $cleanup = Start-Process -FilePath $powershell -ArgumentList $cleanupArguments -PassThru -WindowStyle Normal
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $cleanup.Refresh()
        if ($cleanup.HasExited) { break }
        foreach ($element in (Get-ProcessElements $cleanup.Id)) {
            if ($element.Current.ControlType -eq [Windows.Automation.ControlType]::Window -and
                $element.Current.Name -eq 'Stammzertifikatspeicher') {
                Invoke-AutomationButton $element 'Ja'
                break
            }
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    if (-not $cleanup.HasExited) {
        Stop-Process -Id $cleanup.Id -Force -ErrorAction SilentlyContinue
        $cleanup.WaitForExit(5000) | Out-Null
        $cleanup.Refresh()
    }
    Assert-Condition ($cleanup.HasExited -and $cleanup.ExitCode -eq 0) 'Das isolierte Testzertifikat konnte nicht entfernt werden.'
}

try {
    foreach ($required in @($binary, $firstRun, $stopScript)) {
        Assert-Condition (Test-Path -LiteralPath $required) "First-Run-Testbestandteil fehlt: $required"
    }
    New-Item -ItemType Directory -Path $testRoot, $timeoutRoot, $dataRoot -Force | Out-Null

    Write-Output 'Phase: Portkonflikt-Dialog wird sichtbar geprüft.'
    $conflictPorts = Get-FreePorts 3
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $conflictPorts[0])
    $listener.Start()
    try {
        $conflictProcess = Start-FirstRun $dataRoot $conflictPorts 60
        $conflictWindow = Wait-ProcessElement $conflictProcess.Id 'Benötigte Ports sind belegt' 20
        Assert-Condition (-not $conflictWindow.Current.IsOffscreen) 'Der Portkonflikt-Dialog ist nicht sichtbar.'
        $portLine = $null
        $conflictElements = $conflictWindow.FindAll(
            [Windows.Automation.TreeScope]::Descendants,
            [Windows.Automation.Condition]::TrueCondition
        )
        foreach ($candidate in $conflictElements) {
            if ($candidate.Current.Name -match "Port $($conflictPorts[0]):") { $portLine = $candidate; break }
        }
        $visibleNames = @($conflictElements | ForEach-Object Current | ForEach-Object Name | Where-Object { $_ }) -join ' | '
        Assert-Condition ($null -ne $portLine) "Portnummer fehlt im Konfliktdialog. Sichtbar: $visibleNames"
        Assert-Condition ($portLine.Current.Name -match 'powershell|pwsh') 'Prozessname fehlt im Konfliktdialog.'
        Invoke-AutomationButton $conflictWindow 'Abbrechen'
        Assert-Condition ($conflictProcess.WaitForExit(15000)) 'First-Run blieb nach Abbrechen des Portdialogs hängen.'
        Assert-Condition ($conflictProcess.ExitCode -eq 2) 'First-Run meldet den Abbruch nicht.'

        Write-Output 'Phase: Port wird freigegeben und über Erneut prüfen erneut getestet.'
        $retryProcess = Start-FirstRun $dataRoot $conflictPorts 60
        $retryWindow = Wait-ProcessElement $retryProcess.Id 'Benötigte Ports sind belegt' 20
        $listener.Stop()
        Invoke-AutomationButton $retryWindow 'Erneut prüfen'
        $retryForm = Wait-ProcessElement $retryProcess.Id 'Ersatzteillager einrichten' 20
        Assert-Condition (-not $retryForm.Current.IsOffscreen) 'Nach erneuter Prüfung ist kein Zugangsdatenfenster sichtbar.'
        $retryForm.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern).Close()
        Assert-Condition ($retryProcess.WaitForExit(10000)) 'First-Run blieb nach dem Schließen des Einrichtungsfensters hängen.'
    } finally {
        $listener.Stop()
    }

    Write-Output 'Phase: Zehn-Minuten-Schutz wird mit verkürztem Testzeitraum geprüft.'
    $timeoutPorts = Get-FreePorts 3
    $timeoutProcess = Start-FirstRun $timeoutRoot $timeoutPorts 6
    $timeoutForm = Wait-ProcessElement $timeoutProcess.Id 'Ersatzteillager einrichten' 20
    Assert-Condition (-not $timeoutForm.Current.IsOffscreen) 'Das Zugangsdatenfenster ist nicht sichtbar.'
    $timeoutMessage = Wait-ProcessElement $timeoutProcess.Id 'Zeitlimit erreicht' 15
    Assert-Condition (-not $timeoutMessage.Current.IsOffscreen) 'Der Hinweis zum Zeitlimit ist nicht sichtbar.'
    Assert-Condition ($timeoutProcess.WaitForExit(25000)) 'First-Run blieb nach dem Zeitlimit ohne Benutzeraktion hängen.'
    Assert-Condition ($timeoutProcess.ExitCode -eq 3) 'First-Run meldet keinen Zeitlimit-Abbruch.'
    $timeoutLog = Get-Content -LiteralPath (Join-Path $timeoutRoot 'logs\first-run.log') -Raw
    Assert-Condition ($timeoutLog -match 'Zeitlimit erreicht') 'Das Zeitlimit wurde nicht protokolliert.'

    Write-Output 'Phase: Teilabbruch wird vorbereitet und echter Dialogpfad vollständig durchlaufen.'
    $staleBootstrapEmail = 'bootstrap-' + [guid]::NewGuid().ToString('N') + '@example.invalid'
    $dataDir = Join-Path $dataRoot 'pb_data'
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    $commonArguments = @(
        "--dir=$dataDir",
        ('--migrationsDir=' + (Join-Path $InstallRoot 'pb_migrations')),
        ('--publicDir=' + (Join-Path $InstallRoot 'pb_public'))
    )
    & $binary @commonArguments superuser upsert $staleBootstrapEmail $stalePassword *> $null
    Assert-Condition ($LASTEXITCODE -eq 0) 'Der simulierte Teilabbruch konnte nicht vorbereitet werden.'

    $ports = Get-FreePorts 4
    $firstRunProcess = Start-FirstRun $dataRoot $ports 300
    $form = Wait-ProcessElement $firstRunProcess.Id 'Ersatzteillager einrichten' 30
    Assert-Condition (-not $form.Current.IsOffscreen) 'Das echte First-Run-Fenster ist nicht sichtbar.'
    Assert-Condition ($form.Current.BoundingRectangle.Width -gt 100) 'Das First-Run-Fenster besitzt keine sichtbare Größe.'
    Set-AutomationValue $form 'E-Mail-Adresse' $adminEmail
    Set-AutomationValue $form 'Anzeigename' 'Beispiel Administrator'
    Set-AutomationValue $form 'Passwort' $adminPassword
    Set-AutomationValue $form 'Passwort wiederholen' $adminPassword
    Invoke-AutomationButton $form 'Einrichten und starten'

    $completed = $null
    $completionDeadline = [DateTime]::UtcNow.AddSeconds(180)
    do {
        foreach ($element in (Get-ProcessElements $firstRunProcess.Id)) {
            if ($element.Current.ControlType -ne [Windows.Automation.ControlType]::Window) { continue }
            if ($element.Current.Name -eq 'Sicherheitswarnung') {
                Invoke-AutomationButton $element 'Ja'
                Start-Sleep -Milliseconds 300
                continue
            }
            if ($element.Current.Name -eq 'Einrichtung fehlgeschlagen') {
                throw 'Der echte First-Run-Dialog hat eine Fehlermeldung angezeigt.'
            }
            if ($element.Current.Name -eq 'Ersatzteillager ist bereit') {
                $completed = $element
                break
            }
        }
        if (-not $completed) { Start-Sleep -Milliseconds 250 }
    } while (-not $completed -and [DateTime]::UtcNow -lt $completionDeadline)
    Assert-Condition ($null -ne $completed) 'Der First-Run-Dialog wurde nicht innerhalb von drei Minuten abgeschlossen.'
    Invoke-AutomationButton $completed 'OK'
    Assert-Condition ($firstRunProcess.WaitForExit(30000)) 'First-Run wurde nach erfolgreicher Einrichtung nicht beendet.'
    Assert-Condition ($firstRunProcess.ExitCode -eq 0) "First-Run endete mit Code $($firstRunProcess.ExitCode)."
    Assert-Condition (Test-Path -LiteralPath (Join-Path $dataRoot 'setup-complete.json')) 'Abschlussmarkierung fehlt.'
    $started = $true

    $runtime = Get-Content -LiteralPath (Join-Path $dataRoot 'run\runtime.json') -Raw | ConvertFrom-Json
    Assert-Condition (Wait-Http $runtime.setupUrl 20) 'Die geöffnete Einrichtungsseite ist nicht erreichbar.'
    $healthJson = & curl.exe -k -sS ($runtime.appUrl + 'api/health')
    $health = $healthJson | ConvertFrom-Json
    Assert-Condition ($health.code -eq 200) 'PocketBase oder Caddy wurde im First-Run nicht gestartet.'
    $authBody = @{ identity = $adminEmail; password = $adminPassword } | ConvertTo-Json -Compress
    $auth = (& curl.exe -k -sS -H 'Content-Type: application/json' --data-raw $authBody `
        ($runtime.appUrl + 'api/collections/users/auth-with-password')) | ConvertFrom-Json
    Assert-Condition ([bool]$auth.token) 'Der über den Dialog angelegte Administrator kann sich nicht anmelden.'

    & $stopScript -InstallRoot $InstallRoot -DataRoot $dataRoot | Out-Null
    $started = $false

    Write-Output 'Phase: Abgebrochene Einrichtung aus 1.0.1 wird über den vorhandenen Abschlussmarker repariert.'
    $markerFile = Join-Path $dataRoot 'setup-complete.json'
    $marker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
    $marker.PSObject.Properties.Remove('bootstrapCleaned')
    $marker | ConvertTo-Json | Set-Content -LiteralPath $markerFile -Encoding UTF8
    & $binary @commonArguments superuser upsert $staleBootstrapEmail $stalePassword *> $null
    Assert-Condition ($LASTEXITCODE -eq 0) 'Der alte Teilzustand konnte nicht vorbereitet werden.'
    $repairProcess = Start-FirstRun $dataRoot $ports 60
    $repaired = Wait-ProcessElement $repairProcess.Id 'Bereits eingerichtet' 40
    Invoke-AutomationButton $repaired 'OK'
    Assert-Condition ($repairProcess.WaitForExit(10000) -and $repairProcess.ExitCode -eq 0) 'Die Reparatur aus 1.0.1 ist fehlgeschlagen.'
    $repairedMarker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
    Assert-Condition ($repairedMarker.bootstrapCleaned -eq $true) 'Die Bootstrap-Bereinigung wurde nicht im Abschlussmarker bestätigt.'

    Write-Output 'Phase: Bootstrap-Bereinigung und dauerhaftes Recovery-Konto werden geprüft.'
    $auditEmail = 'audit-' + [guid]::NewGuid().ToString('N') + '@example.invalid'
    & $binary @commonArguments superuser upsert $auditEmail $auditPassword *> $null
    Assert-Condition ($LASTEXITCODE -eq 0) 'Audit-Superuser konnte nicht temporär angelegt werden.'
    $auditPort = $ports[3]
    $auditLog = Join-Path $testRoot 'audit-pocketbase.log'
    $auditError = Join-Path $testRoot 'audit-pocketbase-error.log'
    $auditArguments = @(
        '--dir', ('"{0}"' -f $dataDir), '--migrationsDir', ('"{0}"' -f (Join-Path $InstallRoot 'pb_migrations')),
        '--publicDir', ('"{0}"' -f (Join-Path $InstallRoot 'pb_public')), 'serve', "--http=127.0.0.1:$auditPort"
    )
    $auditProcess = Start-Process -FilePath $binary -ArgumentList $auditArguments -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $auditLog -RedirectStandardError $auditError
    Assert-Condition (Wait-Http "http://127.0.0.1:$auditPort/api/health" 30) 'Audit-PocketBase ist nicht erreichbar.'
    $auditAuthBody = @{ identity = $auditEmail; password = $auditPassword } | ConvertTo-Json
    $auditAuth = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$auditPort/api/collections/_superusers/auth-with-password" `
        -ContentType 'application/json' -Body $auditAuthBody
    $superusers = (Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$auditPort/api/collections/_superusers/records?perPage=200" `
        -Headers @{ Authorization = $auditAuth.token }).items
    Assert-Condition (@($superusers | Where-Object email -match '^bootstrap-').Count -eq 0) 'Ein Bootstrap-Superuser blieb zurück.'
    Assert-Condition (@($superusers | Where-Object email -match '^recovery-').Count -ge 1) 'Der dauerhafte Recovery-Superuser fehlt.'
    Stop-Process -Id $auditProcess.Id -ErrorAction SilentlyContinue
    $auditProcess.WaitForExit(10000) | Out-Null
    $auditProcess = $null
    & $binary @commonArguments superuser delete $auditEmail *> $null
    Assert-Condition ($LASTEXITCODE -eq 0) 'Audit-Superuser konnte nicht entfernt werden.'

    Write-Output 'Phase: UTF-8-BOM und zugangsdatenfreies First-Run-Protokoll werden geprüft.'
    foreach ($scriptFile in (Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'scripts') -Filter '*.ps1' -File)) {
        $bytes = [IO.File]::ReadAllBytes($scriptFile.FullName)
        Assert-Condition ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) `
            "UTF-8-BOM fehlt: $($scriptFile.Name)"
        $text = [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
        Assert-Condition ($text -notmatch 'Ã.|Â.|â€¦|â€') "Beschädigte sichtbare Zeichen in $($scriptFile.Name)"
    }
    foreach ($visibleFile in (Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'onboarding') -Recurse -File |
        Where-Object Extension -in @('.html', '.js', '.css'))) {
        $text = [IO.File]::ReadAllText($visibleFile.FullName, [Text.Encoding]::UTF8)
        Assert-Condition ($text -notmatch 'Ã.|Â.|â€¦|â€') "Beschädigte sichtbare Zeichen in $($visibleFile.Name)"
    }
    $firstRunLog = Get-Content -LiteralPath (Join-Path $dataRoot 'logs\first-run.log') -Raw
    foreach ($secret in @($adminPassword, $stalePassword, $auditPassword)) {
        Assert-Condition (-not $firstRunLog.Contains($secret)) 'Ein Passwort wurde im First-Run-Protokoll gefunden.'
    }

    [pscustomobject]@{
        PortConflictDialog = 'bestanden'
        RetryAndCancelButtons = 'bestanden'
        VisibleFirstRunWindow = 'bestanden'
        TimeoutAbort = 'bestanden'
        AutomatedDialogInput = 'bestanden'
        BootstrapCleanup = 'bestanden'
        PreviousVersionRepair = 'bestanden'
        RecoverySuperuser = 'bestanden'
        PocketBaseAndCaddyStart = 'bestanden'
        SetupPage = 'bestanden'
        Utf8Bom = 'bestanden'
        VisibleTextEncoding = 'bestanden'
        SecretFreeLog = 'bestanden'
    } | Format-List
} catch {
    foreach ($diagnosticRoot in @($dataRoot, $timeoutRoot)) {
        $diagnosticLog = Join-Path $diagnosticRoot 'logs\first-run.log'
        if (Test-Path -LiteralPath $diagnosticLog) { Get-Content -LiteralPath $diagnosticLog -Tail 12 | Write-Output }
    }
    throw
} finally {
    $adminPassword = $null
    $stalePassword = $null
    $auditPassword = $null
    foreach ($child in $firstRunProcesses) {
        if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction SilentlyContinue }
    }
    if ($auditProcess -and -not $auditProcess.HasExited) { Stop-Process -Id $auditProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($started -and (Test-Path -LiteralPath $stopScript)) {
        & $stopScript -InstallRoot $InstallRoot -DataRoot $dataRoot 2>$null | Out-Null
    }
    $testRootCertificate = Join-Path $dataRoot 'caddy-data\caddy\pki\authorities\local\root.crt'
    Remove-TestRootCertificate $testRootCertificate
    if (Test-Path -LiteralPath $testRoot) {
        $testFull = [IO.Path]::GetFullPath($testRoot)
        $parentFull = [IO.Path]::GetFullPath($testParent).TrimEnd('\') + '\'
        if ($testFull.StartsWith($parentFull, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $testFull -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

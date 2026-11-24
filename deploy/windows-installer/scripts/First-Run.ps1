param(
    [string]$InstallRoot,
    [string]$DataRoot,
    [ValidateRange(1, 65535)][int]$PocketBasePort = 8090,
    [ValidateRange(1, 65535)][int]$SetupPort = 8080,
    [ValidateRange(1, 65535)][int]$HttpsPort = 8443,
    [ValidateRange(1, 3600)][int]$TimeoutSeconds = 600
)

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $InstallRoot) { $InstallRoot = Get-InstallerRoot }
if (-not $DataRoot) { $DataRoot = Get-ApplicationDataRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
Assert-SafeApplicationDirectory $DataRoot

$logDirectory = Join-Path $DataRoot 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logFile = Join-Path $logDirectory 'first-run.log'
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
$script:firstRunStage = 'Start'
$script:timedOut = $false

function Write-FirstRunLog {
    param(
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level,
        [string]$Event,
        [string]$Details = ''
    )
    # Formularwerte und Prozessargumente werden absichtlich nie protokolliert.
    $safeEvent = ($Event -replace '[\r\n]+', ' ').Trim()
    $safeDetails = ($Details -replace '[\r\n]+', ' ').Trim()
    $line = '{0} [{1}] {2}' -f [DateTime]::UtcNow.ToString('o'), $Level, $safeEvent
    if ($safeDetails) { $line += ' | ' + $safeDetails }
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

function Test-FirstRunDeadline {
    if ([DateTime]::UtcNow -ge $deadline) {
        throw [TimeoutException]::new('Die Ersteinrichtung hat das Zeitlimit von zehn Minuten erreicht.')
    }
}

function Get-PortConflicts {
    $ports = @($SetupPort, $PocketBasePort, $HttpsPort) | Select-Object -Unique
    $activePorts = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -in $ports } | ForEach-Object Port | Select-Object -Unique)
    $conflicts = New-Object Collections.Generic.List[object]

    # netstat liefert PID und Port ohne den auf frischen Konten teilweise sehr
    # langsamen ersten Modulstart von Get-NetTCPConnection.
    $connections = @()
    if ($activePorts.Count -gt 0) {
        $connections = @(& (Join-Path $env:SystemRoot 'System32\netstat.exe') -ano -p TCP 2>$null |
            ForEach-Object {
                if ($_ -match '^\s*TCP\s+\S+:(\d+)\s+(?:0\.0\.0\.0|\[::\]):0\s+\S+\s+(\d+)\s*$') {
                    [pscustomobject]@{ LocalPort = [int]$matches[1]; OwningProcess = [int]$matches[2] }
                }
            } | Where-Object { $_.LocalPort -in $activePorts })
    }

    foreach ($port in $ports) {
        $portConnections = @($connections | Where-Object LocalPort -eq $port)
        if ($portConnections.Count -eq 0 -and $port -notin $activePorts) { continue }
        if ($portConnections.Count -eq 0) {
            $conflicts.Add([pscustomobject]@{ Port = $port; ProcessId = $null; ProcessName = 'unbekannter Prozess' })
            continue
        }
        foreach ($connection in ($portConnections | Sort-Object OwningProcess -Unique)) {
            $processName = 'unbekannter Prozess'
            try {
                $owner = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
                $processName = $owner.ProcessName + '.exe'
            } catch {
                # Geschützte Systemprozesse lassen ihren Namen eventuell nicht auslesen.
            }
            $conflicts.Add([pscustomobject]@{
                Port = [int]$port
                ProcessId = [int]$connection.OwningProcess
                ProcessName = $processName
            })
        }
    }
    return @($conflicts | Sort-Object Port, ProcessName -Unique)
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FirstRunWindow {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@
[Windows.Forms.Application]::EnableVisualStyles()

function Show-WindowInForeground([Windows.Forms.Form]$Window) {
    $Window.TopMost = $true
    $Window.Activate()
    $Window.BringToFront()
    [FirstRunWindow]::ShowWindow($Window.Handle, 9) | Out-Null
    [FirstRunWindow]::SetForegroundWindow($Window.Handle) | Out-Null
}

function Show-TimeoutMessage([Windows.Forms.IWin32Window]$Owner) {
    $script:timedOut = $true
    Write-FirstRunLog -Level ERROR -Event 'Zeitlimit erreicht' -Details ('Phase: ' + $script:firstRunStage)
    $notice = New-Object Windows.Forms.Form
    $notice.Text = 'Zeitlimit erreicht'
    $notice.ClientSize = New-Object Drawing.Size(575, 160)
    $notice.StartPosition = 'CenterScreen'
    $notice.FormBorderStyle = 'FixedDialog'
    $notice.MaximizeBox = $false
    $notice.MinimizeBox = $false
    $notice.AutoScaleMode = 'Dpi'

    $message = New-Object Windows.Forms.Label
    $message.Text = "Die Ersteinrichtung wurde wegen Zeitüberschreitung abgebrochen.`r`n`r`nProtokoll: $logFile"
    $message.SetBounds(16, 16, 540, 92)
    $notice.Controls.Add($message)
    $okay = New-Object Windows.Forms.Button
    $okay.Text = 'OK'
    $okay.SetBounds(476, 115, 80, 32)
    $okay.DialogResult = [Windows.Forms.DialogResult]::OK
    $notice.AcceptButton = $okay
    $notice.Controls.Add($okay)

    # Auch ohne Bestätigung muss der wartende Installer weiterlaufen.
    $dismissTimer = New-Object Windows.Forms.Timer
    $dismissTimer.Interval = 15000
    $dismissTimer.Add_Tick({ $notice.Close() })
    $notice.Add_Shown({ Show-WindowInForeground $notice; $dismissTimer.Start() })
    try {
        if ($Owner) { [void]$notice.ShowDialog($Owner) } else { [void]$notice.ShowDialog() }
    } finally {
        $dismissTimer.Dispose()
        $notice.Dispose()
    }
}

function Show-PortConflictDialog([object[]]$Conflicts) {
    $dialog = New-Object Windows.Forms.Form
    $dialog.Text = 'Benötigte Ports sind belegt'
    $dialog.Size = New-Object Drawing.Size(650, 360)
    $dialog.StartPosition = 'CenterScreen'
    $dialog.FormBorderStyle = 'FixedDialog'
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false
    $dialog.AutoScaleMode = 'Dpi'

    $title = New-Object Windows.Forms.Label
    $title.Text = 'Die Ersteinrichtung kann noch nicht gestartet werden.'
    $title.Font = New-Object Drawing.Font('Segoe UI', 13, [Drawing.FontStyle]::Bold)
    $title.Location = New-Object Drawing.Point(24, 20)
    $title.Size = New-Object Drawing.Size(585, 32)
    $dialog.Controls.Add($title)

    $intro = New-Object Windows.Forms.Label
    $intro.Text = 'Beenden oder konfigurieren Sie die folgenden Programme und prüfen Sie anschließend erneut:'
    $intro.Location = New-Object Drawing.Point(26, 62)
    $intro.Size = New-Object Drawing.Size(580, 38)
    $dialog.Controls.Add($intro)

    $details = New-Object Windows.Forms.TextBox
    $details.Multiline = $true
    $details.ReadOnly = $true
    $details.ScrollBars = 'Vertical'
    $details.BackColor = [Drawing.SystemColors]::Window
    $details.Font = New-Object Drawing.Font('Segoe UI', 10)
    $details.Location = New-Object Drawing.Point(28, 104)
    $details.Size = New-Object Drawing.Size(575, 120)
    $details.Lines = @($Conflicts | ForEach-Object {
        $pidText = if ($null -ne $_.ProcessId) { " (PID $($_.ProcessId))" } else { '' }
        "Port $($_.Port): $($_.ProcessName)$pidText"
    })
    $details.AccessibleName = 'Portkonflikte: ' + ($details.Lines -join '; ')
    $dialog.Controls.Add($details)

    $hint = New-Object Windows.Forms.Label
    $hint.Text = 'Ersatzteillager benötigt 8080 für die Einrichtungsseite, 8090 intern und 8443 für lokales HTTPS.'
    $hint.Location = New-Object Drawing.Point(28, 234)
    $hint.Size = New-Object Drawing.Size(575, 42)
    $dialog.Controls.Add($hint)

    $retryButton = New-Object Windows.Forms.Button
    $retryButton.Text = 'Erneut prüfen'
    $retryButton.Location = New-Object Drawing.Point(339, 279)
    $retryButton.Size = New-Object Drawing.Size(128, 34)
    $retryButton.DialogResult = [Windows.Forms.DialogResult]::Retry
    $dialog.Controls.Add($retryButton)

    $cancelButton = New-Object Windows.Forms.Button
    $cancelButton.Text = 'Abbrechen'
    $cancelButton.Location = New-Object Drawing.Point(475, 279)
    $cancelButton.Size = New-Object Drawing.Size(128, 34)
    $cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $dialog.CancelButton = $cancelButton
    $dialog.Controls.Add($cancelButton)

    $timer = New-Object Windows.Forms.Timer
    $timer.Interval = 1000
    $timer.Add_Tick({
        if ([DateTime]::UtcNow -ge $deadline) {
            $timer.Stop()
            Show-TimeoutMessage $dialog
            $dialog.DialogResult = [Windows.Forms.DialogResult]::Abort
            $dialog.Close()
        }
    })
    $dialog.Add_Shown({ Show-WindowInForeground $dialog; $timer.Start() })
    try {
        return $dialog.ShowDialog()
    } finally {
        $timer.Stop()
        $timer.Dispose()
        $dialog.Dispose()
    }
}

function Confirm-PortsAvailable {
    while ($true) {
        Test-FirstRunDeadline
        $conflicts = @(Get-PortConflicts)
        if ($conflicts.Count -eq 0) {
            Write-FirstRunLog -Level INFO -Event 'Portprüfung erfolgreich'
            return $true
        }
        $summary = ($conflicts | ForEach-Object { "Port $($_.Port): $($_.ProcessName)" }) -join '; '
        Write-FirstRunLog -Level WARN -Event 'Portkonflikt' -Details $summary
        $choice = Show-PortConflictDialog $conflicts
        if ($choice -eq [Windows.Forms.DialogResult]::Retry) { continue }
        return $false
    }
}

Write-FirstRunLog -Level INFO -Event 'Ersteinrichtung gestartet'
$markerFile = Join-Path $DataRoot 'setup-complete.json'
if (Test-Path -LiteralPath $markerFile -PathType Leaf) {
    try {
        $marker = Get-Content -LiteralPath $markerFile -Raw | ConvertFrom-Json
        if ($marker.bootstrapCleaned -ne $true) {
            $script:firstRunStage = 'Bootstrap-Bereinigung'
            if (-not (Confirm-PortsAvailable)) {
                if ($script:timedOut) { exit 3 }
                Write-FirstRunLog -Level WARN -Event 'Vom Benutzer abgebrochen' -Details $script:firstRunStage
                exit 2
            }
            & (Join-Path $InstallRoot 'scripts\Initialize-Instance.ps1') `
                -InstallRoot $InstallRoot -DataRoot $DataRoot -RepairBootstrap
            Write-FirstRunLog -Level INFO -Event 'Bootstrap-Bereinigung abgeschlossen'
        }
        [void][Windows.Forms.MessageBox]::Show(
            'Diese Installation wurde bereits eingerichtet. Verwenden Sie die Desktop-Verknüpfung „Ersatzteillager starten“.',
            'Bereits eingerichtet', 'OK', 'Information'
        )
        exit 0
    } catch [TimeoutException] {
        Show-TimeoutMessage $null
        exit 3
    } catch {
        Write-FirstRunLog -Level ERROR -Event 'Vorhandene Einrichtung konnte nicht geprüft werden' `
            -Details $_.Exception.GetType().FullName
        [void][Windows.Forms.MessageBox]::Show(
            "Die vorhandene Einrichtung konnte nicht geprüft werden.`r`n`r`nProtokoll: $logFile",
            'Einrichtung fehlgeschlagen', 'OK', 'Error'
        )
        exit 4
    }
}

$script:firstRunStage = 'Portprüfung'
try {
    if (-not (Confirm-PortsAvailable)) {
        if ($script:timedOut) { exit 3 }
        Write-FirstRunLog -Level WARN -Event 'Vom Benutzer abgebrochen' -Details 'Phase: Portprüfung'
        exit 2
    }
} catch [TimeoutException] {
    Show-TimeoutMessage $null
    exit 3
} catch {
    Write-FirstRunLog -Level ERROR -Event 'Portprüfung fehlgeschlagen' -Details $_.Exception.GetType().FullName
    [Windows.Forms.MessageBox]::Show(
        "Die benötigten Netzwerkports konnten nicht geprüft werden.`r`n`r`nHinweise stehen in:`r`n$logFile",
        'Portprüfung fehlgeschlagen', 'OK', 'Error'
    ) | Out-Null
    exit 4
}

$form = New-Object Windows.Forms.Form
$form.Text = 'Ersatzteillager einrichten'
$form.Size = New-Object Drawing.Size(570, 500)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.AutoScaleMode = 'Dpi'

$title = New-Object Windows.Forms.Label
$title.Text = 'Ersten Administrator anlegen'
$title.Font = New-Object Drawing.Font('Segoe UI', 16, [Drawing.FontStyle]::Bold)
$title.Location = New-Object Drawing.Point(28, 24)
$title.Size = New-Object Drawing.Size(500, 34)
$form.Controls.Add($title)

$description = New-Object Windows.Forms.Label
$description.Text = "Diese Angaben gelten nur für diese Installation. Das Passwort wird nicht angezeigt oder protokolliert.`r`nMindestens 12 Zeichen verwenden."
$description.Location = New-Object Drawing.Point(30, 68)
$description.Size = New-Object Drawing.Size(500, 48)
$form.Controls.Add($description)

function Add-Field([string]$Label, [int]$Top, [switch]$Password) {
    $caption = New-Object Windows.Forms.Label
    $caption.Text = $Label
    $caption.Location = New-Object Drawing.Point(30, $Top)
    $caption.Size = New-Object Drawing.Size(500, 22)
    $form.Controls.Add($caption) | Out-Null
    $field = New-Object Windows.Forms.TextBox
    $field.Location = New-Object Drawing.Point(30, ($Top + 24))
    $field.Size = New-Object Drawing.Size(495, 30)
    $field.Font = New-Object Drawing.Font('Segoe UI', 11)
    $field.AccessibleName = $Label
    if ($Password) { $field.UseSystemPasswordChar = $true }
    $form.Controls.Add($field) | Out-Null
    return $field
}

$emailField = Add-Field 'E-Mail-Adresse' 125
$nameField = Add-Field 'Anzeigename' 190
$passwordField = Add-Field 'Passwort' 255 -Password
$confirmField = Add-Field 'Passwort wiederholen' 320 -Password

$status = New-Object Windows.Forms.Label
$status.Location = New-Object Drawing.Point(30, 388)
$status.Size = New-Object Drawing.Size(330, 44)
$status.ForeColor = [Drawing.Color]::FromArgb(24, 80, 120)
$form.Controls.Add($status)

$setupButton = New-Object Windows.Forms.Button
$setupButton.Text = 'Einrichten und starten'
$setupButton.Location = New-Object Drawing.Point(365, 392)
$setupButton.Size = New-Object Drawing.Size(160, 38)
$setupButton.BackColor = [Drawing.Color]::FromArgb(0, 120, 190)
$setupButton.ForeColor = [Drawing.Color]::White
$setupButton.FlatStyle = 'Flat'
$form.AcceptButton = $setupButton
$form.Controls.Add($setupButton)

$setupButton.Add_Click({
    if ($emailField.Text -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        [Windows.Forms.MessageBox]::Show('Bitte eine gültige E-Mail-Adresse eingeben.', 'Eingabe prüfen', 'OK', 'Warning') | Out-Null
        return
    }
    if ([string]::IsNullOrWhiteSpace($nameField.Text)) {
        [Windows.Forms.MessageBox]::Show('Bitte einen Anzeigenamen eingeben.', 'Eingabe prüfen', 'OK', 'Warning') | Out-Null
        return
    }
    if ($passwordField.Text.Length -lt 12) {
        [Windows.Forms.MessageBox]::Show('Das Passwort muss mindestens 12 Zeichen lang sein.', 'Eingabe prüfen', 'OK', 'Warning') | Out-Null
        return
    }
    if ($passwordField.Text -ne $confirmField.Text) {
        [Windows.Forms.MessageBox]::Show('Die beiden Passwörter stimmen nicht überein.', 'Eingabe prüfen', 'OK', 'Warning') | Out-Null
        return
    }

    $setupButton.Enabled = $false
    $form.UseWaitCursor = $true
    try {
        $script:firstRunStage = 'Erneute Portprüfung'
        $timeoutTimer.Stop()
        if (-not (Confirm-PortsAvailable)) {
            $form.DialogResult = [Windows.Forms.DialogResult]::Abort
            $form.Close()
            return
        }
        Test-FirstRunDeadline
        $script:firstRunStage = 'Datenbank und Administrator'
        $status.Text = 'Datenbank und Administrator werden eingerichtet …'
        [Windows.Forms.Application]::DoEvents()
        Write-FirstRunLog -Level INFO -Event 'Initialisierung begonnen'
        $securePassword = New-Object Security.SecureString
        foreach ($character in $passwordField.Text.ToCharArray()) {
            $securePassword.AppendChar($character)
        }
        $securePassword.MakeReadOnly()
        & (Join-Path $InstallRoot 'scripts\Initialize-Instance.ps1') `
            -AdminEmail $emailField.Text.Trim() -AdminName $nameField.Text.Trim() `
            -AdminPassword $securePassword -InstallRoot $InstallRoot -DataRoot $DataRoot

        $passwordField.Clear()
        $confirmField.Clear()
        Test-FirstRunDeadline
        $script:firstRunStage = 'HTTPS-Start'
        $status.Text = 'HTTPS-Zugang wird gestartet …'
        [Windows.Forms.Application]::DoEvents()
        & (Join-Path $InstallRoot 'scripts\Start-Ersatzteillager.ps1') `
            -InstallRoot $InstallRoot -DataRoot $DataRoot -PocketBasePort $PocketBasePort `
            -SetupPort $SetupPort -HttpsPort $HttpsPort -NoBrowser

        Test-FirstRunDeadline
        $runtimeFile = Join-Path $DataRoot 'run\runtime.json'
        if (Test-Path -LiteralPath $runtimeFile) {
            $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
            Start-Process ([string]$runtime.setupUrl) | Out-Null
        }
        Write-FirstRunLog -Level INFO -Event 'Ersteinrichtung erfolgreich abgeschlossen'
        [Windows.Forms.MessageBox]::Show(
            'Die Einrichtung ist abgeschlossen. Die Handy-Anleitung mit QR-Code wurde im Browser geöffnet.',
            'Ersatzteillager ist bereit', 'OK', 'Information'
        ) | Out-Null
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    } catch [TimeoutException] {
        $status.Text = 'Einrichtung wegen Zeitüberschreitung abgebrochen.'
        Show-TimeoutMessage $form
        $form.DialogResult = [Windows.Forms.DialogResult]::Abort
        $form.Close()
    } catch {
        $status.Text = 'Einrichtung nicht abgeschlossen.'
        Write-FirstRunLog -Level ERROR -Event 'Ersteinrichtung fehlgeschlagen' `
            -Details ("Phase: $script:firstRunStage; Typ: $($_.Exception.GetType().FullName)")
        [Windows.Forms.MessageBox]::Show(
            "Die Einrichtung konnte in der Phase '$script:firstRunStage' nicht abgeschlossen werden.`r`n`r`nProtokoll: $logFile",
            'Einrichtung fehlgeschlagen', 'OK', 'Error'
        ) | Out-Null
        $setupButton.Enabled = $true
        $timeoutTimer.Start()
    } finally {
        $passwordField.Clear()
        $confirmField.Clear()
        $form.UseWaitCursor = $false
    }
})

$timeoutTimer = New-Object Windows.Forms.Timer
$timeoutTimer.Interval = 1000
$timeoutTimer.Add_Tick({
    if ([DateTime]::UtcNow -ge $deadline) {
        $timeoutTimer.Stop()
        Show-TimeoutMessage $form
        $form.DialogResult = [Windows.Forms.DialogResult]::Abort
        $form.Close()
    }
})
$foregroundTimer = New-Object Windows.Forms.Timer
$foregroundTimer.Interval = 1500
$foregroundTimer.Add_Tick({ $foregroundTimer.Stop(); $form.TopMost = $false })
$form.Add_Shown({
    $script:firstRunStage = 'Warten auf Zugangsdaten'
    Show-WindowInForeground $form
    Write-FirstRunLog -Level INFO -Event 'Zugangsdatenfenster sichtbar geöffnet'
    $timeoutTimer.Start()
    $foregroundTimer.Start()
})

try {
    $result = $form.ShowDialog()
    if ($result -eq [Windows.Forms.DialogResult]::OK) { exit 0 }
    if ($script:timedOut) { exit 3 }
    Write-FirstRunLog -Level WARN -Event 'Vom Benutzer abgebrochen' -Details ('Phase: ' + $script:firstRunStage)
    exit 2
} finally {
    $timeoutTimer.Stop()
    $foregroundTimer.Stop()
    $timeoutTimer.Dispose()
    $foregroundTimer.Dispose()
    $form.Dispose()
}

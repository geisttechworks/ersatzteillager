param(
    [string]$InstallRoot,
    [string]$DataRoot
)

. (Join-Path $PSScriptRoot 'Common.ps1')

if (-not $InstallRoot) { $InstallRoot = Get-InstallerRoot }
if (-not $DataRoot) { $DataRoot = Get-ApplicationDataRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

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
    $status.Text = 'Datenbank und Administrator werden eingerichtet …'
    [Windows.Forms.Application]::DoEvents()
    try {
        $securePassword = ConvertTo-SecureString $passwordField.Text -AsPlainText -Force
        & (Join-Path $InstallRoot 'scripts\Initialize-Instance.ps1') `
            -AdminEmail $emailField.Text.Trim() -AdminName $nameField.Text.Trim() `
            -AdminPassword $securePassword -InstallRoot $InstallRoot -DataRoot $DataRoot

        $passwordField.Clear()
        $confirmField.Clear()
        $status.Text = 'HTTPS-Zugang wird gestartet …'
        [Windows.Forms.Application]::DoEvents()
        & (Join-Path $InstallRoot 'scripts\Start-Ersatzteillager.ps1') `
            -InstallRoot $InstallRoot -DataRoot $DataRoot -NoBrowser

        $runtimeFile = Join-Path $DataRoot 'run\runtime.json'
        if (Test-Path -LiteralPath $runtimeFile) {
            $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
            Start-Process ([string]$runtime.setupUrl) | Out-Null
        }
        [Windows.Forms.MessageBox]::Show(
            'Die Einrichtung ist abgeschlossen. Die Handy-Anleitung mit QR-Code wurde im Browser geöffnet.',
            'Ersatzteillager ist bereit', 'OK', 'Information'
        ) | Out-Null
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    } catch {
        $status.Text = 'Einrichtung nicht abgeschlossen.'
        [Windows.Forms.MessageBox]::Show(
            "Die Einrichtung konnte nicht abgeschlossen werden.`r`n`r`n$($_.Exception.Message)",
            'Einrichtung fehlgeschlagen', 'OK', 'Error'
        ) | Out-Null
        $setupButton.Enabled = $true
    } finally {
        $passwordField.Clear()
        $confirmField.Clear()
        $form.UseWaitCursor = $false
    }
})

if (Test-Path -LiteralPath (Join-Path $DataRoot 'setup-complete.json')) {
    [Windows.Forms.MessageBox]::Show(
        'Diese Installation wurde bereits eingerichtet. Verwenden Sie die Desktop-Verknüpfung „Ersatzteillager starten“.',
        'Bereits eingerichtet', 'OK', 'Information'
    ) | Out-Null
} else {
    [void]$form.ShowDialog()
}

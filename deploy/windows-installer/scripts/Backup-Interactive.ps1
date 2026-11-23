$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
$confirmation = [Windows.Forms.MessageBox]::Show(
    "Für eine konsistente Sicherung werden Ersatzteillager und HTTPS kurz angehalten. Nach dem ZIP-Backup startet die Anwendung automatisch wieder.`r`n`r`nJetzt fortfahren?",
    'Backup erstellen', 'YesNo', 'Information'
)
if ($confirmation -ne [Windows.Forms.DialogResult]::Yes) { return }

$dialog = New-Object Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Ordner für die Sicherung auswählen'
$dialog.ShowNewFolderButton = $true
$dialog.SelectedPath = [Environment]::GetFolderPath('MyDocuments')

if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return }

try {
    $backup = & (Join-Path $PSScriptRoot 'Backup-Ersatzteillager.ps1') -DestinationDirectory $dialog.SelectedPath
    [Windows.Forms.MessageBox]::Show(
        "Die Sicherung wurde erstellt:`r`n$backup`r`n`r`nBewahren Sie mindestens eine Kopie auf einem anderen Datenträger auf.",
        'Backup abgeschlossen', 'OK', 'Information'
    ) | Out-Null
} catch {
    [Windows.Forms.MessageBox]::Show(
        "Das Backup konnte nicht erstellt werden.`r`n`r`n$($_.Exception.Message)",
        'Backup fehlgeschlagen', 'OK', 'Error'
    ) | Out-Null
    exit 1
}

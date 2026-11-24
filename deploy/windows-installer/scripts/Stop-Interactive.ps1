$ErrorActionPreference = 'Stop'

try {
    & (Join-Path $PSScriptRoot 'Stop-Ersatzteillager.ps1') | Out-Null
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show(
        'Ersatzteillager wurde beendet. Die Lagerdaten bleiben erhalten.',
        'Ersatzteillager', 'OK', 'Information'
    ) | Out-Null
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show(
        "Ersatzteillager konnte nicht vollständig beendet werden.`r`n`r`n$($_.Exception.Message)",
        'Beenden fehlgeschlagen', 'OK', 'Error'
    ) | Out-Null
    exit 1
}

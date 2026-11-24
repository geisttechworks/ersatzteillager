param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$ruleNames = @('Ersatzteillager HTTPS im privaten WLAN', 'Ersatzteillager Einrichtung im privaten WLAN')

foreach ($name in $ruleNames) {
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
}

if ($Remove) { return }

New-NetFirewallRule -DisplayName $ruleNames[0] -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort 8443 -Profile Private -Description 'Lokaler HTTPS-Zugang zum Ersatzteillager im privaten WLAN.' | Out-Null
New-NetFirewallRule -DisplayName $ruleNames[1] -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort 8080 -Profile Private -Description 'Einrichtungsseite und öffentliches WLAN-Stammzertifikat.' | Out-Null

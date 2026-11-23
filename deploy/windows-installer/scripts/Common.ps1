$ErrorActionPreference = 'Stop'

function Get-InstallerRoot {
    if ($env:ERSATZTEILLAGER_INSTALL_ROOT) {
        return [IO.Path]::GetFullPath($env:ERSATZTEILLAGER_INSTALL_ROOT)
    }
    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Get-ApplicationDataRoot {
    if ($env:ERSATZTEILLAGER_DATA_ROOT) {
        return [IO.Path]::GetFullPath($env:ERSATZTEILLAGER_DATA_ROOT)
    }
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw 'LOCALAPPDATA ist nicht verfügbar.'
    }
    return [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Ersatzteillager'))
}

function Assert-SafeApplicationDirectory([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if (-not $full -or $full -eq $root) {
        throw "Unsicherer Verzeichnispfad: $Path"
    }
}

function Get-LanIPv4 {
    $candidates = @()
    try {
        $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
            Where-Object { $_.State -eq 'Alive' } |
            Sort-Object RouteMetric, InterfaceMetric
        foreach ($route in $routes) {
            $addresses = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue |
                Where-Object {
                    $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
                    $_.AddressState -eq 'Preferred'
                }
            foreach ($address in $addresses) {
                $candidates += [pscustomobject]@{
                    Address = $address.IPAddress
                    Metric = [int]$route.RouteMetric + [int]$route.InterfaceMetric
                }
            }
        }
    } catch {
        # Auf älteren Windows-Systemen folgt unten die DNS-basierte Ermittlung.
    }

    if ($candidates.Count -eq 0) {
        try {
            foreach ($address in [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName())) {
                if ($address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
                    $address.IPAddressToString -notmatch '^(127\.|169\.254\.)') {
                    $candidates += [pscustomobject]@{ Address = $address.IPAddressToString; Metric = 9999 }
                }
            }
        } catch {
            # Die verständliche Fehlermeldung folgt unterhalb.
        }
    }

    $selected = $candidates | Sort-Object Metric | Select-Object -First 1
    if (-not $selected) {
        throw 'Keine aktive IPv4-Adresse im lokalen Netzwerk gefunden. Bitte WLAN oder LAN verbinden.'
    }
    return [string]$selected.Address
}

function Wait-HttpEndpoint([string]$Uri, [int]$Attempts = 40, [switch]$AllowUntrustedCertificate) {
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        Start-Sleep -Milliseconds 500
        try {
            if ($AllowUntrustedCertificate -and $PSVersionTable.PSVersion.Major -ge 7) {
                Invoke-WebRequest -Uri $Uri -TimeoutSec 2 -UseBasicParsing -SkipCertificateCheck | Out-Null
            } elseif ($AllowUntrustedCertificate) {
                $oldCallback = [Net.ServicePointManager]::ServerCertificateValidationCallback
                try {
                    [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
                    Invoke-WebRequest -Uri $Uri -TimeoutSec 2 -UseBasicParsing | Out-Null
                } finally {
                    [Net.ServicePointManager]::ServerCertificateValidationCallback = $oldCallback
                }
            } else {
                Invoke-WebRequest -Uri $Uri -TimeoutSec 2 -UseBasicParsing | Out-Null
            }
            return $true
        } catch {
            # Der Server benötigt beim ersten Start einige Sekunden.
        }
    }
    return $false
}

function Write-ControlledProcess([Diagnostics.Process]$Process, [string]$Executable, [string]$ControlFile) {
    $state = [ordered]@{
        pid = $Process.Id
        startTimeUtcTicks = $Process.StartTime.ToUniversalTime().Ticks
        executable = [IO.Path]::GetFullPath($Executable)
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $ControlFile -Encoding UTF8
}

function Get-ControlledProcess([string]$ControlFile, [string]$ExpectedExecutable) {
    if (-not (Test-Path -LiteralPath $ControlFile)) { return $null }
    try {
        $state = Get-Content -LiteralPath $ControlFile -Raw | ConvertFrom-Json
        $process = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
        if (-not $process) { return $null }
        if ($process.StartTime.ToUniversalTime().Ticks -ne [long]$state.startTimeUtcTicks) { return $null }
        if ([IO.Path]::GetFullPath($process.Path) -ne [IO.Path]::GetFullPath($ExpectedExecutable)) { return $null }
        return $process
    } catch {
        return $null
    }
}

function Stop-ControlledProcess([string]$ControlFile, [string]$ExpectedExecutable) {
    $process = Get-ControlledProcess $ControlFile $ExpectedExecutable
    if ($process) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        try { Wait-Process -Id $process.Id -Timeout 8 -ErrorAction Stop } catch {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $ControlFile -Force -ErrorAction SilentlyContinue
}

function Convert-SecureStringToPlainText([Security.SecureString]$Value) {
    return [Net.NetworkCredential]::new('', $Value).Password
}

function New-BootstrapPassword {
    return 'Aa1!' + [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
}

function Convert-ToCaddyPath([string]$Path) {
    return ([IO.Path]::GetFullPath($Path)).Replace('\', '/')
}

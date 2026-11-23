$ErrorActionPreference = 'Stop'

function Get-PackageRoot {
    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
}

function Import-AppConfig([string]$PackageRoot) {
    $envFile = Join-Path $PackageRoot '.env'
    if (-not (Test-Path -LiteralPath $envFile)) {
        throw '.env fehlt. Kopieren Sie zuerst .env.example nach .env und passen Sie die Werte an.'
    }
    $config = @{}
    foreach ($line in Get-Content -LiteralPath $envFile) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        $separator = $trimmed.IndexOf('=')
        if ($separator -lt 1) { throw "Ungültige Zeile in .env: $trimmed" }
        $name = $trimmed.Substring(0, $separator).Trim()
        if ($name -notmatch '^[A-Z][A-Z0-9_]*$') { throw "Ungültiger Variablenname in .env: $name" }
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $config[$name] = $value
    }
    return $config
}

function Get-ConfigValue([hashtable]$Config, [string]$Name, [string]$Default = '') {
    if ($Config.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string]$Config[$Name])) {
        return [string]$Config[$Name]
    }
    return $Default
}

function Resolve-AppPath([string]$PackageRoot, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw 'Ein erforderlicher Pfadwert ist leer.' }
    if ([IO.Path]::IsPathRooted($Value)) { return [IO.Path]::GetFullPath($Value) }
    return [IO.Path]::GetFullPath((Join-Path $PackageRoot $Value))
}

function Assert-AppOrigin([string]$Origin) {
    if ($Origin -notmatch '^https://[A-Za-z0-9.-]+(?::[0-9]+)?$') {
        throw 'APP_ORIGIN muss eine einzelne HTTPS-Origin ohne Pfad enthalten.'
    }
}

function Assert-SafeDirectory([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if (-not $full -or $full -eq $root) { throw "Unsicherer Verzeichnispfad: $Path" }
}

function Get-BackupMirrorProcess([string]$ControlFile) {
    if (-not (Test-Path -LiteralPath $ControlFile)) { return $null }
    $control = (Get-Content -LiteralPath $ControlFile -Raw).Trim()
    if ($control -notmatch '^(\d+)\|(\d+)$') { return $null }
    $processId = [int]$Matches[1]
    $expectedStartTicks = [long]$Matches[2]
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if (-not $process -or $process.ProcessName -notin @('pwsh', 'powershell')) { return $null }
    try {
        if ($process.StartTime.ToUniversalTime().Ticks -ne $expectedStartTicks) { return $null }
        return $process
    } catch {
        return $null
    }
}

param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$mapUrl = 'http://localhost:4173/maps/lamang'
$statusUrl = 'http://127.0.0.1:4173/__mirror/status'

function Test-MapServer {
    try {
        $status = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 3
        return ($null -ne $status.cached_resources -and $null -ne $status.offline)
    } catch { return $false }
}

try {
    $operaPaths = @(
        "$env:LOCALAPPDATA\Programs\Opera GX\opera.exe",
        "$env:ProgramFiles\Opera GX\opera.exe",
        "${env:ProgramFiles(x86)}\Opera GX\opera.exe"
    )
    $operaPath = $operaPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $operaPath) { throw 'Opera GX was not found. Install Opera GX, then try this shortcut again.' }

    $serverMutex = New-Object System.Threading.Mutex($false, 'Local\GZWPersonalMapLauncher')
    $lockTaken = $false
    try {
        $lockTaken = $serverMutex.WaitOne(15000)
        if (-not $lockTaken) { throw 'The map is already starting. Please try again in a few seconds.' }
        if (-not (Test-MapServer)) {
            $listener = Get-NetTCPConnection -LocalPort 4173 -State Listen -ErrorAction SilentlyContinue
            if ($listener) { throw 'Another application is using port 4173. Close it before starting the map.' }
            $pythonPath = 'C:\Program Files\Python313\pythonw.exe'
            if (-not (Test-Path -LiteralPath $pythonPath)) {
                $pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
            }
            $serverPath = Join-Path $PSScriptRoot 'server.py'
            $cachePath = Join-Path $PSScriptRoot 'cache'
            New-Item -ItemType Directory -Path $cachePath -Force | Out-Null
            Start-Process -FilePath $pythonPath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $cachePath 'desktop-server-output.log') -RedirectStandardError (Join-Path $cachePath 'desktop-server-error.log') | Out-Null
            $ready = $false
            for ($attempt = 0; $attempt -lt 30; $attempt++) {
                if (Test-MapServer) { $ready = $true; break }
                Start-Sleep -Milliseconds 300
            }
            if (-not $ready) { throw 'The map server did not start. Details are in the cache\desktop-server-error.log file.' }
        }
    } finally {
        if ($lockTaken) { $serverMutex.ReleaseMutex() }
        $serverMutex.Dispose()
    }

    if ($CheckOnly) {
        Write-Output "Map server ready: $mapUrl"
        Write-Output "Browser: $operaPath"
    } else {
        Start-Process -FilePath $operaPath -ArgumentList $mapUrl | Out-Null
    }
} catch {
    if ($CheckOnly) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'GZW Tac Map', 'OK', 'Error') | Out-Null
    exit 1
}

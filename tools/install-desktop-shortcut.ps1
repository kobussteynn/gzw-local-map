$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$desktopPath = [Environment]::GetFolderPath('Desktop')
$artifactPath = Join-Path $projectPath 'artifacts'
New-Item -ItemType Directory -Path $artifactPath -Force | Out-Null
$pngPath = Join-Path $artifactPath 'desktop-icon.png'
$iconPath = Join-Path $artifactPath 'desktop-icon.ico'

if (-not (Test-Path -LiteralPath $pngPath)) {
    Invoke-WebRequest -Uri 'https://gzwtacmap.com/favicon.png' -OutFile $pngPath -UseBasicParsing
}
Add-Type -AssemblyName System.Drawing
$sourceImage = [System.Drawing.Image]::FromFile($pngPath)
$bitmap = New-Object System.Drawing.Bitmap($sourceImage, (New-Object System.Drawing.Size(48,48)))
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$iconStream = [System.IO.File]::Create($iconPath)
try { $icon.Save($iconStream) } finally { $iconStream.Dispose(); $icon.Dispose(); $bitmap.Dispose(); $sourceImage.Dispose() }

$shortcutPath = Join-Path $desktopPath 'GZW Tac Map.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcherPath = Join-Path $projectPath 'open-map.ps1'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '"'
$shortcut.WorkingDirectory = $projectPath
$shortcut.IconLocation = $iconPath + ',0'
$shortcut.WindowStyle = 7
$shortcut.Description = 'Open your personal GZW Tac Map in Opera GX. Starts the local server automatically.'
$shortcut.Save()
Write-Output "Created desktop shortcut: $shortcutPath"

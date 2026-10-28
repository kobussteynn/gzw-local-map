$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\browser-selection.ps1')
$settings = Join-Path ([System.IO.Path]::GetTempPath()) ('gzw-browser-test-' + [guid]::NewGuid() + '.json')
try {
    if ($null -ne (Read-GzwBrowserPreference $settings)) { throw 'Missing settings must request browser selection.' }
    '{invalid json' | Set-Content -LiteralPath $settings
    if ($null -ne (Read-GzwBrowserPreference $settings)) { throw 'Corrupt settings must request browser selection.' }
    @{ Name = 'Windows default browser'; Path = '' } | ConvertTo-Json | Set-Content -LiteralPath $settings
    if ((Read-GzwBrowserPreference $settings).Name -ne 'Windows default browser') { throw 'Default browser did not persist.' }
    @{ Name = 'Removed browser'; Path = 'Z:\not-installed\browser.exe' } | ConvertTo-Json | Set-Content -LiteralPath $settings
    if ($null -ne (Read-GzwBrowserPreference $settings)) { throw 'An unavailable browser must request selection again.' }
    $options = @(Get-GzwBrowserOptions)
    if ($options[0].Name -ne 'Windows default browser') { throw 'System default option must always be available.' }
    foreach ($option in $options | Select-Object -Skip 1) {
        if (-not (Test-Path -LiteralPath $option.Path -PathType Leaf)) { throw 'Browser discovery returned an unavailable executable.' }
        $option | ConvertTo-Json | Set-Content -LiteralPath $settings
        if ((Read-GzwBrowserPreference $settings).Path -ne $option.Path) { throw 'Saved browser path did not round trip.' }
    }
    foreach ($script in @('open-map.ps1', 'tools\browser-selection.ps1', 'tools\install-desktop-shortcut.ps1')) {
        $tokens = $null; $parseErrors = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Split-Path -Parent $PSScriptRoot) $script), [ref]$tokens, [ref]$parseErrors)
        if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
    }
    Write-Output 'Browser preference, discovery and launcher syntax checks passed.'
} finally {
    if (Test-Path -LiteralPath $settings) { Remove-Item -LiteralPath $settings }
}

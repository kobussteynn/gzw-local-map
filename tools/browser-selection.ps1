function Get-GzwBrowserOptions {
    $options = @([pscustomobject]@{ Name = 'Windows default browser'; Path = '' })
    $browsers = @(
        @{ Name = 'Opera GX'; Relative = 'Opera GX\opera.exe' },
        @{ Name = 'Opera'; Relative = 'Opera\opera.exe' },
        @{ Name = 'Google Chrome'; Relative = 'Google\Chrome\Application\chrome.exe' },
        @{ Name = 'Microsoft Edge'; Relative = 'Microsoft\Edge\Application\msedge.exe' },
        @{ Name = 'Mozilla Firefox'; Relative = 'Mozilla Firefox\firefox.exe' },
        @{ Name = 'Brave'; Relative = 'BraveSoftware\Brave-Browser\Application\brave.exe' },
        @{ Name = 'Vivaldi'; Relative = 'Vivaldi\Application\vivaldi.exe' }
    )
    foreach ($browser in $browsers) {
        $paths = @(
            (Join-Path "$env:LOCALAPPDATA\Programs" $browser.Relative),
            (Join-Path $env:LOCALAPPDATA $browser.Relative),
            (Join-Path $env:ProgramFiles $browser.Relative)
        )
        if (${env:ProgramFiles(x86)}) { $paths += Join-Path ${env:ProgramFiles(x86)} $browser.Relative }
        $found = $paths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if ($found) { $options += [pscustomobject]@{ Name = $browser.Name; Path = $found } }
    }
    return $options
}

function Read-GzwBrowserPreference([string]$SettingsPath) {
    if (-not (Test-Path -LiteralPath $SettingsPath)) { return $null }
    try {
        $saved = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
        if ($saved.Name -eq 'Windows default browser' -and $saved.Path -eq '') { return $saved }
        if ($saved.Name -and $saved.Path -and (Test-Path -LiteralPath $saved.Path -PathType Leaf)) { return $saved }
    } catch { }
    return $null
}

function Show-GzwBrowserPicker([object[]]$Options, $Current) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'GZW Tac Map - Choose browser'
    $form.ClientSize = New-Object System.Drawing.Size(450, 185)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "Which browser should open GZW Tac Map?`r`nThis choice applies only to this map and will be remembered."
    $label.SetBounds(18, 18, 415, 42)
    $list = New-Object System.Windows.Forms.ComboBox
    $list.SetBounds(18, 70, 414, 28)
    $list.DropDownStyle = 'DropDownList'
    foreach ($option in $Options) { [void]$list.Items.Add($option.Name) }
    $list.SelectedIndex = 0
    if ($Current) {
        for ($i = 0; $i -lt $Options.Count; $i++) {
            if ($Options[$i].Name -eq $Current.Name) { $list.SelectedIndex = $i; break }
        }
    }
    $open = New-Object System.Windows.Forms.Button
    $open.Text = 'Save and open'
    $open.SetBounds(195, 125, 125, 32)
    $open.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.SetBounds(330, 125, 102, 32)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label, $list, $open, $cancel))
    $form.AcceptButton = $open
    $form.CancelButton = $cancel
    try {
        if ($form.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $Options[$list.SelectedIndex] }
        return $null
    } finally { $form.Dispose() }
}

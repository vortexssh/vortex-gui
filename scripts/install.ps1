#requires -Version 5.1
<#
.SYNOPSIS
  Install Vortex GUI on Windows from GitHub Releases (NSIS / MSI).

.EXAMPLE
  irm https://raw.githubusercontent.com/vortexssh/vortex-gui/master/scripts/install.ps1 | iex

.EXAMPLE
  .\install.ps1 -Version 0.1.0
#>
[CmdletBinding()]
param(
  [string]$Version = $(if ($env:VORTEX_GUI_VERSION) { $env:VORTEX_GUI_VERSION } else { 'latest' }),
  [string]$Repo = $(if ($env:VORTEX_GUI_REPO) { $env:VORTEX_GUI_REPO } else { 'vortexssh/vortex-gui' }),
  [ValidateSet('nsis', 'msi')]
  [string]$Preferred = $(if ($env:VORTEX_GUI_PREFERRED) { $env:VORTEX_GUI_PREFERRED } else { 'nsis' }),
  [switch]$Silent = $true
)

$ErrorActionPreference = 'Stop'

function Get-Release {
  param([string]$RepoName, [string]$Ver)
  $headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'vortex-gui-install'
  }
  if ($env:VORTEX_GUI_GITHUB_TOKEN) {
    $headers['Authorization'] = "Bearer $($env:VORTEX_GUI_GITHUB_TOKEN)"
  }
  if ($Ver -eq 'latest') {
    $url = "https://api.github.com/repos/$RepoName/releases/latest"
  } else {
    $tag = if ($Ver.StartsWith('v')) { $Ver } else { "v$Ver" }
    $url = "https://api.github.com/repos/$RepoName/releases/tags/$tag"
  }
  return Invoke-RestMethod -Uri $url -Headers $headers
}

function Select-Asset {
  param($Release, [string]$Pref)
  $assets = @($Release.assets)
  $nsis = $assets | Where-Object { $_.name -match '(?i)setup\.exe$|-setup\.exe$' -or ($_.name -match '(?i)\.exe$' -and $_.name -notmatch '(?i)\.msi$') }
  $msi = $assets | Where-Object { $_.name -match '(?i)\.msi$' }

  if ($Pref -eq 'msi' -and $msi) { return $msi | Select-Object -First 1 }
  if ($nsis) { return $nsis | Select-Object -First 1 }
  if ($msi) { return $msi | Select-Object -First 1 }
  throw "No Windows installer (.exe / .msi) found in release assets: $($assets.name -join ', ')"
}

Write-Host "Vortex GUI installer"
Write-Host "  repo=$Repo  version=$Version  preferred=$Preferred"

$release = Get-Release -RepoName $Repo -Ver $Version
$asset = Select-Asset -Release $release -Pref $Preferred
Write-Host "asset: $($asset.name)"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) $asset.name
Write-Host "↓ $($asset.browser_download_url)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing

try {
  if ($asset.name -match '(?i)\.msi$') {
    $args = @('/i', "`"$tmp`"", '/norestart')
    if ($Silent) { $args += '/quiet' }
    Write-Host "running msiexec $($args -join ' ')"
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) {
      throw "msiexec failed with exit code $($p.ExitCode)"
    }
  } else {
    # Tauri NSIS: /S = silent
    $args = @()
    if ($Silent) { $args += '/S' }
    Write-Host "running $($asset.name) $($args -join ' ')"
    $p = Start-Process -FilePath $tmp -ArgumentList $args -Wait -PassThru
    if ($p.ExitCode -ne 0) {
      throw "NSIS installer failed with exit code $($p.ExitCode)"
    }
  }
  Write-Host "done. Launch Vortex GUI from the Start menu."
  Write-Host "data dir: $env:APPDATA\ru.timant32.vortex-gui\  (or ~/.config/vortex-gui via WSL — native uses AppData)"
}
finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $tmp
}

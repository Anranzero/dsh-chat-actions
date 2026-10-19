#!/usr/bin/env pwsh
# Install dsh-chat-actions into a DSH profile.
#
#   .\install.ps1                       # default profile: desktop
#   .\install.ps1 -Profile web          # another profile
#   .\install.ps1 -FromClone            # link this working copy instead of GitHub
#
# Preferred path is `dsh plugin add`, which installs through pnpm AND appends the
# bundle to `dsh.profile.bundles` (the profile layer that actually loads it).
[CmdletBinding()]
param(
    [string]$Profile = 'desktop',
    [string]$Spec = 'github:Anranzero/dsh-chat-actions',
    [switch]$FromClone,
    [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' })
)

$ErrorActionPreference = 'Stop'

if ($FromClone) {
    $Spec = 'link:' + ($PSScriptRoot -replace '\\', '/')
}

$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
    Write-Host "No DSH profile at $profileDir" -ForegroundColor Red
    Write-Host 'Start DSH once with that profile, or pass -Profile <name>.'
    exit 1
}

Write-Host "DSH home : $DshHome"
Write-Host "Profile  : $Profile"
Write-Host "Spec     : $Spec"
Write-Host ''

# `dsh plugin` resolves the profile through DSH_HOME, so -DshHome must reach it too.
$env:DSH_HOME = $DshHome

$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) {
    & dsh plugin --profile $Profile add $Spec
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host 'dsh plugin add failed. See the output above.' -ForegroundColor Red
        exit $LASTEXITCODE
    }
} else {
    Write-Host 'dsh CLI not on PATH; falling back to a direct pnpm install.' -ForegroundColor Yellow
    Push-Location $profileDir
    try {
        & pnpm add $Spec
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
    # `dsh plugin add` normally maintains this list; do it by hand when it cannot.
    $manifestPath = Join-Path $profileDir 'package.json'
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if (-not $manifest.dsh) { $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) }
    if (-not $manifest.dsh.profile) { $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) }
    $bundles = @($manifest.dsh.profile.bundles)
    if ($bundles -notcontains 'dsh-chat-actions') {
        $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue ($bundles + 'dsh-chat-actions') -Force
        $manifest | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 $manifestPath
        Write-Host 'Added dsh-chat-actions to dsh.profile.bundles.'
    }
}

Write-Host ''
Write-Host 'Verifying the profile layer...'
$dump = & dsh --profile $Profile --dump-config 2>&1 | Out-String
if ($dump -match 'dsh-chat-actions') {
    Write-Host 'OK: the profile loads dsh-chat-actions.' -ForegroundColor Green
} else {
    Write-Host 'The profile does not list the plugin yet; restart DSH once and re-run the check.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Restart DSH (or reopen the window) to load the plugin.'

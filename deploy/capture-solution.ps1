<#
Exports the unmanaged solution from an environment and unpacks it over solution/src,
so components you added through the maker portal end up in source control.

Run this after adding components in the portal (plug-in assembly, Custom APIs,
custom pages, web resources). Without it, build.ps1 produces a smaller solution
than the one you exported by hand for a release.

Prereq: pac CLI authenticated.
  pac auth create --environment https://yourorg.crm4.dynamics.com

Usage:
  ./capture-solution.ps1
  ./capture-solution.ps1 -EnvironmentUrl https://yourorg.crm4.dynamics.com
  ./capture-solution.ps1 -SkipExport      # unpack a zip you already exported
#>
param(
    [string]$EnvironmentUrl,
    [string]$SolutionName = "ConversationDiagnostics",
    [switch]$SkipExport
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$outDir = Join-Path $root "out"
# SolutionPackager convention for packagetype Both: the unmanaged zip and a
# sibling <name>_managed.zip in the same folder.
$zip = Join-Path $outDir "$SolutionName.zip"
$managedZip = Join-Path $outDir "${SolutionName}_managed.zip"
$srcDir = Join-Path $root "solution/src"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# --- Export both flavours ---
# The cdsproj builds SolutionPackageType=Both, so the unpacked source has to carry
# managed metadata too. That needs both zips.
if (-not $SkipExport) {
    foreach ($flavour in @(@{ Managed = "false"; Path = $zip }, @{ Managed = "true"; Path = $managedZip })) {
        $exportArgs = @("solution", "export", "--path", $flavour.Path, "--name", $SolutionName, "--managed", $flavour.Managed, "--overwrite")
        if ($EnvironmentUrl) { $exportArgs += @("--environment", $EnvironmentUrl) }
        Write-Host "pac $($exportArgs -join ' ')" -ForegroundColor DarkGray
        & pac @exportArgs
        if ($LASTEXITCODE -ne 0) { throw "Export failed ($($flavour.Path))." }
    }
}

if (-not (Test-Path $zip))        { throw "No unmanaged solution zip at $zip." }
if (-not (Test-Path $managedZip)) { throw "No managed solution zip at $managedZip. Both are needed for packagetype Both." }

# --- Unpack over source ---
Write-Host "Unpacking over solution/src (packagetype Both)..." -ForegroundColor Cyan
& pac solution unpack --zipfile $zip --folder $srcDir --packagetype Both --allowDelete
if ($LASTEXITCODE -ne 0) { throw "Unpack failed." }

# --- Check for leaked configuration ---
# Environment variable VALUES are environment-specific and can carry your tenant id,
# client id and, if you used the plain fallback, a client secret. They must not be
# committed. Definitions are fine; values are not.
$leaks = @()

$valueFiles = Get-ChildItem -Path $srcDir -Recurse -Filter "*.xml" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "environmentvariablevalue" }
foreach ($f in $valueFiles) { $leaks += $f.FullName }

$defFiles = Get-ChildItem -Path (Join-Path $srcDir "environmentvariabledefinitions") -Recurse -Filter "*.xml" -ErrorAction SilentlyContinue
foreach ($f in $defFiles) {
    $xml = Get-Content $f.FullName -Raw
    if ($xml -match "<defaultvalue>(?<v>.+?)</defaultvalue>" -and $Matches.v.Trim()) {
        $leaks += "$($f.FullName)  (defaultvalue = $($Matches.v))"
    }
}

if ($leaks.Count -gt 0) {
    Write-Host ""
    Write-Host "WARNING - environment-specific values found in the unpacked source:" -ForegroundColor Red
    $leaks | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "These carry your tenant id, client id, App Insights App ID, or a client secret." -ForegroundColor Yellow
    Write-Host "Clear them before committing. Definitions belong in source control; values do not." -ForegroundColor Yellow
} else {
    Write-Host "No environment-specific values found in the unpacked source." -ForegroundColor Green
}

# --- Report what landed ---
Write-Host ""
Write-Host "Component folders now under solution/src:" -ForegroundColor Cyan
Get-ChildItem -Path $srcDir -Directory | ForEach-Object { Write-Host "  $($_.Name)" }

Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Review the diff, especially Other/Solution.xml (version and publisher)."
Write-Host "  2. Clear any environment-specific values flagged above."
Write-Host "  3. Run ./build.ps1 and confirm the zip now matches what you released."
Write-Host "  4. Commit."

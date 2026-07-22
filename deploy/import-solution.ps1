<#
Imports the built solution into a Dataverse environment and publishes it.

Prereq: pac CLI installed and authenticated.
  dotnet tool install --global Microsoft.PowerApps.CLI.Tool
  pac auth create --environment https://yourorg.crm4.dynamics.com

Usage:
  ./import-solution.ps1                                   # unmanaged, active auth profile
  ./import-solution.ps1 -EnvironmentUrl https://org.crm4.dynamics.com
  ./import-solution.ps1 -Managed                          # import the managed zip instead
  ./import-solution.ps1 -WaitMinutes 30                   # longer timeout for slow imports

Notes:
  -ForceOverwrite is ON by default. Importing an unmanaged solution over an environment
  where you have edited components by hand will overwrite those edits. That is normally
  what you want during development; pass -NoForceOverwrite to keep local changes.
#>
param(
    [string]$EnvironmentUrl,
    [switch]$Managed,
    [switch]$NoForceOverwrite,
    [int]$WaitMinutes = 15
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$releaseDir = Join-Path $root "solution/bin/Release"

# --- Locate the zip ---
$zipName = if ($Managed) { "ConversationDiagnostics_managed.zip" } else { "ConversationDiagnostics.zip" }
$zip = Join-Path $releaseDir $zipName

if (-not (Test-Path $zip)) {
    $available = if (Test-Path $releaseDir) { (Get-ChildItem $releaseDir -Filter *.zip | Select-Object -ExpandProperty Name) -join ", " } else { "none" }
    throw "Solution zip not found at $zip. Run build.ps1 first. Available in $($releaseDir): $available"
}

$size = [math]::Round((Get-Item $zip).Length / 1KB, 1)
$built = (Get-Item $zip).LastWriteTime
Write-Host "Importing $zipName ($size KB, built $built)" -ForegroundColor Cyan

# --- Check authentication ---
$authList = pac auth list 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $authList -notmatch "\S") {
    throw "No pac auth profile found. Run: pac auth create --environment https://yourorg.crm4.dynamics.com"
}
if (-not $EnvironmentUrl) {
    Write-Host "Using the active pac auth profile:" -ForegroundColor DarkGray
    Write-Host ($authList.Trim())
}

# --- Build the argument list ---
$importArgs = @(
    "solution", "import",
    "--path", $zip,
    "--publish-changes",            # publish on success, so you do not have to
    "--activate-plugins",
    "--async",
    "--max-async-wait-time", $WaitMinutes
)
if (-not $NoForceOverwrite) { $importArgs += "--force-overwrite" }
if ($EnvironmentUrl)        { $importArgs += @("--environment", $EnvironmentUrl) }

Write-Host "pac $($importArgs -join ' ')" -ForegroundColor DarkGray
& pac @importArgs
if ($LASTEXITCODE -ne 0) { throw "Solution import failed." }

Write-Host ""
Write-Host "Import complete and changes published." -ForegroundColor Green
Write-Host "Hard refresh the browser (Ctrl+F5) - code components cache aggressively." -ForegroundColor Yellow
Write-Host "If you changed a custom page, republish the model-driven app that hosts it." -ForegroundColor Yellow

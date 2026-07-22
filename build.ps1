# Local build.
#   1. Installs PCF deps and builds the two controls (via the solution cdsproj)
#   2. Builds the plugin assembly separately
# Outputs:
#   - solution/bin/Release/*.zip           (managed + unmanaged, contains the PCF controls)
#   - src/plugin/.../bin/Release/net462/ConversationDiagnosticsPlugins.dll
param(
    # Increments the patch version in both control manifests. Dataverse only refreshes a
    # code component when its version changes, so bump before rebuilding if you want an
    # import to actually replace the running control.
    [switch]$BumpControls,
    # Import into Dataverse after a successful build (delegates to deploy/import-solution.ps1).
    [switch]$Import,
    [string]$EnvironmentUrl,
    [switch]$Managed
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

if ($BumpControls) {
    foreach ($manifest in Get-ChildItem -Path (Join-Path $root "src/controls") -Recurse -Filter "ControlManifest.Input.xml") {
        $text = Get-Content $manifest.FullName -Raw
        $updated = [regex]::Replace($text, '(constructor="[^"]+" version=")(\d+)\.(\d+)\.(\d+)(")', {
            param($m)
            "$($m.Groups[1].Value)$($m.Groups[2].Value).$($m.Groups[3].Value).$([int]$m.Groups[4].Value + 1)$($m.Groups[5].Value)"
        })
        Set-Content -Path $manifest.FullName -Value $updated -NoNewline
        $v = [regex]::Match($updated, 'constructor="[^"]+" version="([^"]+)"').Groups[1].Value
        Write-Host "Bumped $($manifest.Directory.Name) to $v" -ForegroundColor Cyan
    }
}

# Keep the packaged copy of the settings page in step with the source of truth.
$wrSource = Join-Path $root "src/webresources/pwr_settings.html"
$wrTarget = Join-Path $root "solution/src/WebResources/pwr_settings.html"
if (Test-Path $wrSource) {
    New-Item -ItemType Directory -Force -Path (Split-Path $wrTarget) | Out-Null
    Copy-Item $wrSource $wrTarget -Force
}

function Install-Deps($path) {
    if (Test-Path (Join-Path $path "package-lock.json")) { npm ci --prefix $path } else { npm install --prefix $path }
    if ($LASTEXITCODE -ne 0) { throw "npm failed in $path" }
}

Install-Deps (Join-Path $root "src/controls/ConversationAnalyzer")
Install-Deps (Join-Path $root "src/controls/RoutingOverview")

# Strong-name key for the plugin (generated without sn.exe)
$snk = Join-Path $root "src/plugin/ConversationDiagnostics.Plugins/ConversationDiagnostics.snk"
if (-not (Test-Path $snk)) {
    Write-Host "Generating strong-name key..."
    $rsa = [System.Security.Cryptography.RSACryptoServiceProvider]::new(1024)
    [System.IO.File]::WriteAllBytes($snk, $rsa.ExportCspBlob($true))
    $rsa.Dispose()
}

# Build the plugin assembly on its own
dotnet build (Join-Path $root "src/plugin/ConversationDiagnostics.Plugins/ConversationDiagnostics.Plugins.csproj") -c Release
if ($LASTEXITCODE -ne 0) { throw "Plugin build failed" }

# Build the solution (packs the two PCF controls into managed + unmanaged zips)
dotnet build (Join-Path $root "solution/ConversationDiagnostics.cdsproj") -c Release
if ($LASTEXITCODE -ne 0) { throw "Solution build failed" }

if ($Import) {
    Write-Host ""
    Write-Host "Importing into Dataverse..." -ForegroundColor Cyan
    $importScript = Join-Path $root "deploy/import-solution.ps1"
    $importArgs = @{}
    if ($EnvironmentUrl) { $importArgs["EnvironmentUrl"] = $EnvironmentUrl }
    if ($Managed)        { $importArgs["Managed"] = $true }
    & $importScript @importArgs
    if ($LASTEXITCODE -ne 0) { throw "Import failed" }
}

Write-Host ""
Write-Host "Done."
Write-Host "  Solution zips: solution/bin/Release"
Write-Host "  Plugin dll:    src/plugin/ConversationDiagnostics.Plugins/bin/Release/net462/ConversationDiagnosticsPlugins.dll"
Write-Host ""
Write-Host "Next: import the solution, then run deploy/push-plugin.ps1 and deploy/register-customapis.ps1"

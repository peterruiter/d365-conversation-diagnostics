# Fallback build path that does NOT use the cdsproj.
# Builds each PCF and the plugin, then uses `pac solution` to pack.
# Use this if build.ps1 (msbuild via cdsproj) keeps failing on your machine.
#
# Prereq: pac CLI  ->  dotnet tool install --global Microsoft.PowerApps.CLI.Tool
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

function Build-Pcf($path) {
    Push-Location $path
    if (Test-Path "package-lock.json") { npm ci } else { npm install }
    npm run build
    Pop-Location
}

Build-Pcf (Join-Path $root "src/controls/ConversationAnalyzer")
Build-Pcf (Join-Path $root "src/controls/RoutingOverview")

# Plugin
dotnet build (Join-Path $root "src/plugin/ConversationDiagnostics.Plugins/ConversationDiagnostics.Plugins.csproj") -c Release

# Pack the solution with pac (reads src/Other + referenced controls)
Push-Location (Join-Path $root "solution")
pac solution pack --zipfile "bin/Release/ConversationDiagnostics.zip" --folder "src" --packagetype Both
Pop-Location
Write-Host "Packed to solution/bin/Release"

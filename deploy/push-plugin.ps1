<#
Registers or updates the plugin assembly in Dataverse.

FIRST REGISTRATION -> use the Plugin Registration Tool (PRT).
  `pac plugin push` cannot do the initial registration: its --pluginId parameter is
  required and that GUID only exists once the assembly is already in the environment.

  Run:  ./push-plugin.ps1 -Register
  This launches PRT. In PRT:
    1. Create connection -> sign in to your environment
    2. Register -> Register New Assembly
    3. Browse to the dll path printed below
    4. Isolation Mode: Sandbox, Location: Database
    5. Register Selected Plugins
  You do NOT register any steps. The plugin types are invoked by Custom APIs,
  which deploy/register-customapis.ps1 creates in the next step.

UPDATES -> once registered, grab the assembly id from PRT and use:
  ./push-plugin.ps1 -Update -PluginId <assembly-guid>

Prereq: pac CLI authenticated:  pac auth create --environment https://yourorg.crm4.dynamics.com
#>
param(
    [switch]$Register,
    [switch]$Update,
    [string]$PluginId
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dll = Join-Path $root "src/plugin/ConversationDiagnostics.Plugins/bin/Release/net462/ConversationDiagnosticsPlugins.dll"

if (-not (Test-Path $dll)) { throw "Plugin dll not found at $dll. Run build.ps1 first." }
Write-Host "Assembly: $dll" -ForegroundColor Cyan

if ($Update) {
    if (-not $PluginId) { throw "-Update requires -PluginId <assembly-guid>. Find it in PRT under the registered assembly." }
    pac plugin push --pluginFile $dll --pluginId $PluginId
    Write-Host "Assembly updated." -ForegroundColor Green
    return
}

# Default / -Register: launch the Plugin Registration Tool
Write-Host ""
Write-Host "Launching Plugin Registration Tool. In PRT:" -ForegroundColor Yellow
Write-Host "  1. Create connection and sign in to your environment"
Write-Host "  2. Register > Register New Assembly"
Write-Host "  3. Browse to the assembly path above"
Write-Host "  4. Isolation Mode: Sandbox   Location: Database"
Write-Host "  5. Register Selected Plugins  (do not add any steps)"
Write-Host ""
pac tool prt

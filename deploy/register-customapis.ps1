<#
Registers the three Custom APIs and binds them to the plugin assembly.
Run once per environment after importing the solution (until the Custom APIs
are captured into the solution src via export — see docs/architecture.md).

Requires: PAC CLI authenticated (pac auth create) or an interactive login.
Usage:    ./register-customapis.ps1 -EnvironmentUrl https://yourorg.crm4.dynamics.com
#>
param(
    [Parameter(Mandatory = $true)][string]$EnvironmentUrl,
    [string]$SolutionUniqueName = "ConversationDiagnostics",
    [string]$PluginAssemblyName = "ConversationDiagnostics.Plugins"
)

$ErrorActionPreference = "Stop"

# --- Acquire token via Azure CLI (device login fallback) ---
$token = az account get-access-token --resource $EnvironmentUrl --query accessToken -o tsv 2>$null
if (-not $token) {
    az login --allow-no-subscriptions | Out-Null
    $token = az account get-access-token --resource $EnvironmentUrl --query accessToken -o tsv
}
$headers = @{ Authorization = "Bearer $token"; "OData-MaxVersion" = "4.0"; "OData-Version" = "4.0"; Accept = "application/json"; "Content-Type" = "application/json" }
$base = "$EnvironmentUrl/api/data/v9.2"

function Invoke-DataverseGet($path) { Invoke-RestMethod -Uri "$base/$path" -Headers $headers -Method Get }
function Invoke-DataversePost($path, $body) {
    Invoke-RestMethod -Uri "$base/$path" -Headers ($headers + @{ Prefer = "return=representation" }) -Method Post -Body ($body | ConvertTo-Json -Depth 10)
}

# --- Locate plugin types ---
$assembly = (Invoke-DataverseGet "pluginassemblies?`$filter=name eq '$PluginAssemblyName'&`$select=pluginassemblyid").value[0]
if (-not $assembly) { throw "Plugin assembly '$PluginAssemblyName' not found. Import the solution first." }
$types = (Invoke-DataverseGet "plugintypes?`$filter=_pluginassemblyid_value eq $($assembly.pluginassemblyid)&`$select=plugintypeid,typename").value
function TypeId($typeName) { ($types | Where-Object typename -eq $typeName).plugintypeid }

$apis = @(
    @{
        UniqueName = "crd_ExecuteDiagnosticsQuery"; DisplayName = "Execute Diagnostics Query"
        PluginType = "ConversationDiagnostics.Plugins.ExecuteDiagnosticsQueryPlugin"
        Inputs = @(
            @{ UniqueName = "QueryKey"; Type = 10; Optional = $false },     # 10 = String
            @{ UniqueName = "TimeRangeHours"; Type = 6; Optional = $true }, # 6  = Integer
            @{ UniqueName = "WorkItemId"; Type = 10; Optional = $true }
        )
        Outputs = @(@{ UniqueName = "ResultJson"; Type = 10 })
    },
    @{
        UniqueName = "crd_GetConversationDiagnostics"; DisplayName = "Get Conversation Diagnostics"
        PluginType = "ConversationDiagnostics.Plugins.GetConversationDiagnosticsPlugin"
        Inputs = @(
            @{ UniqueName = "ConversationId"; Type = 10; Optional = $false },
            @{ UniqueName = "TimeRangeHours"; Type = 6; Optional = $true }
        )
        Outputs = @(@{ UniqueName = "EventsJson"; Type = 10 })
    },
    @{
        UniqueName = "crd_TestDiagnosticsConnection"; DisplayName = "Test Diagnostics Connection"
        PluginType = "ConversationDiagnostics.Plugins.TestConnectionPlugin"
        Inputs = @()
        Outputs = @(@{ UniqueName = "Success"; Type = 0 }, @{ UniqueName = "Message"; Type = 10 }) # 0 = Boolean
    }
)

foreach ($api in $apis) {
    $existing = (Invoke-DataverseGet "customapis?`$filter=uniquename eq '$($api.UniqueName)'&`$select=customapiid").value
    if ($existing.Count -gt 0) { Write-Host "Skipping $($api.UniqueName) (exists)"; continue }

    $body = @{
        uniquename = $api.UniqueName; name = $api.DisplayName; displayname = $api.DisplayName
        description = $api.DisplayName; bindingtype = 0; isfunction = $false; isprivate = $false
        allowedcustomprocessingsteptype = 0; executeprivilegename = ""
        "PluginTypeId@odata.bind" = "/plugintypes($(TypeId $api.PluginType))"
    }
    $created = Invoke-DataversePost "customapis" $body
    Write-Host "Created $($api.UniqueName)"

    foreach ($p in $api.Inputs) {
        Invoke-DataversePost "customapirequestparameters" @{
            uniquename = $p.UniqueName; name = $p.UniqueName; displayname = $p.UniqueName; description = $p.UniqueName
            type = $p.Type; isoptional = $p.Optional
            "CustomAPIId@odata.bind" = "/customapis($($created.customapiid))"
        } | Out-Null
    }
    foreach ($p in $api.Outputs) {
        Invoke-DataversePost "customapiresponseproperties" @{
            uniquename = $p.UniqueName; name = $p.UniqueName; displayname = $p.UniqueName; description = $p.UniqueName
            type = $p.Type
            "CustomAPIId@odata.bind" = "/customapis($($created.customapiid))"
        } | Out-Null
    }
}

Write-Host "Done. Add the Custom APIs to solution '$SolutionUniqueName' and export to capture them permanently."

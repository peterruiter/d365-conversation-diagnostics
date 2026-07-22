# Conversation Diagnostics for Dynamics 365

**See why unified routing did what it did — without giving anyone Azure access.**

Microsoft moved routing diagnostics out of Dynamics and into Azure Application Insights. That works for engineers with an Azure subscription in front of them. It does not work for supervisors and admins who live in Customer Service workspace.

This solution brings the diagnostics back into Dynamics:

- **Routing Overview** — a full replica of the FastTrack "Conversation Diagnostics" dashboard: incoming work items, cross-filtered classification / route-to-queue / assignment / timeline panels, plus problem spotlights (fallback routing, overflow, rejections, slow assignment, long handle times).
- **Conversation Analyzer** — paste one conversation id, get the full event timeline **and a deterministic, rule-based explanation of why routing happened that way**. Every sentence maps 1:1 to telemetry. No AI, no hallucinations.
- **Productivity pane tool** — the same analyzer next to the active conversation or case in Customer Service workspace, id resolved automatically from the session.
- **Settings page** — tenant id, client id, secret, telemetry target. Configured once by an admin. Users never touch Azure.

## How it works

```
CSW / custom pages                      Dataverse                         Azure
┌────────────────────────┐    ┌───────────────────────────┐    ┌─────────────────────────┐
│ Routing Overview (PCF) │    │ Custom APIs (pwr_*)        │    │ Application Insights     │
│ Conversation Analyzer  │───▶│ Plugin: named KQL library, │───▶│ query API                │
│ (PCF, also in prod.    │    │ client-credentials auth,   │    │ (client credentials,     │
│  pane)                 │    │ secret from Key Vault-     │    │  Reader role)            │
└────────────────────────┘    │ backed env var             │    └─────────────────────────┘
                              └───────────────────────────┘
```

Design decisions worth knowing:

- **Users pass query keys, never raw KQL.** The KQL lives server-side in the plugin (`QueryLibrary.cs`), sourced from the [Microsoft FastTrack Conversation Diagnostics dashboard](https://github.com/microsoft/Dynamics-365-FastTrack-Implementation-Assets/tree/master/Customer%20Service/Customer%20Service/ComponentLibrary/AppInsights-Telemetry/ConversationDiagnostics). Nobody can query the workspace beyond what the solution exposes.
- **No Power Automate, no premium connectors, no staging tables.** The plugin calls the query API directly. Lower latency, fewer licenses, fewer moving parts.
- **Secret handling**: Key Vault-backed secret environment variable (`pwr_ClientSecret`) preferred; plain environment variable (`pwr_ClientSecretPlain`) as a documented fallback.

## Prerequisites

- Dynamics 365 Customer Service with unified routing
- Conversation diagnostics exported to Application Insights ([Microsoft docs](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/configure-conversation-diagnostics)) — needs a managed environment
- An Entra app registration with the **Reader** role on the Application Insights resource
- System Administrator to import the solution

## Install

1. Download the latest managed solution from [Releases](../../releases) and import it.
2. Follow **[docs/post-import-setup.md](docs/post-import-setup.md)** — the full runbook.

The import gives you the two PCF controls and the environment variable definitions. The plugin, Custom APIs, settings page and custom pages are separate steps, all covered in the runbook. Two things catch people out:

- **Enable "Power Apps component framework for canvas apps"** on the environment, or the controls will not show up when you build the custom pages.
- **Register the plugin with the Plugin Registration Tool**, not `pac plugin push` — that command cannot do a first registration.

## Repository layout

| Path | Contents |
|---|---|
| `src/plugin` | C# plugin: 3 Custom APIs, config reader, Azure query client, KQL library |
| `src/controls/ConversationAnalyzer` | PCF: timeline + deterministic explanation engine |
| `src/controls/RoutingOverview` | PCF: FastTrack dashboard replica with cross-filtering |
| `src/webresources` | Settings page |
| `src/queries` | The 12 FastTrack KQL queries as standalone `.kql` files |
| `solution` | `cdsproj` solution project (builds managed + unmanaged) |
| `deploy` | Custom API registration script |
| `.github/workflows` | CI: tag `v*` → build → GitHub release with both zips |
| `docs` | [post-import-setup.md](docs/post-import-setup.md) (runbook), [setup-azure.md](docs/setup-azure.md), [setup-app-profile.md](docs/setup-app-profile.md), [architecture.md](docs/architecture.md) |

## Build locally

```powershell
./build.ps1                                   # build only
./build.ps1 -BumpControls                     # bump control versions first (see below)
./build.ps1 -Import                           # build, then import and publish
./build.ps1 -BumpControls -Import             # the usual dev loop
```

Output lands in `solution/bin/Release/` as `ConversationDiagnostics.zip` and `ConversationDiagnostics_managed.zip`.

**Bump control versions when you change PCF code.** Dataverse only refreshes a code component when its version number changes, so reimporting at the same version silently keeps the old control running.

Import on its own, without rebuilding:

```powershell
./deploy/import-solution.ps1                                    # unmanaged, active auth profile
./deploy/import-solution.ps1 -EnvironmentUrl https://org.crm4.dynamics.com
./deploy/import-solution.ps1 -Managed
```

Both require the pac CLI, authenticated once:

```powershell
dotnet tool install --global Microsoft.PowerApps.CLI.Tool
pac auth create --environment https://yourorg.crm4.dynamics.com
```

## Roadmap

- [ ] Capture Custom APIs and custom pages into the solution src (removes the registration script step)
- [ ] Assignment snapshot support (eligible-agent breakdown per assignment cycle)
- [ ] One-click installer page (d365es.com-style)
- [ ] Sovereign cloud endpoints (GCC/Mooncake) via `pwr_Cloud` variable

## License

MIT. KQL query texts originate from Microsoft's FastTrack Implementation Assets (MIT).

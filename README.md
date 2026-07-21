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
│ Routing Overview (PCF) │    │ Custom APIs (crd_*)        │    │ App Insights /           │
│ Conversation Analyzer  │───▶│ Plugin: named KQL library, │───▶│ Log Analytics query API  │
│ (PCF, also in prod.    │    │ client-credentials auth,   │    │ (client credentials,     │
│  pane)                 │    │ secret from Key Vault-     │    │  Reader role)            │
└────────────────────────┘    │ backed env var             │    └─────────────────────────┘
                              └───────────────────────────┘
```

Design decisions worth knowing:

- **Users pass query keys, never raw KQL.** The KQL lives server-side in the plugin (`QueryLibrary.cs`), sourced from the [Microsoft FastTrack Conversation Diagnostics dashboard](https://github.com/microsoft/Dynamics-365-FastTrack-Implementation-Assets/tree/master/Customer%20Service/Customer%20Service/ComponentLibrary/AppInsights-Telemetry/ConversationDiagnostics). Nobody can query the workspace beyond what the solution exposes.
- **No Power Automate, no premium connectors, no staging tables.** The plugin calls the query API directly. Lower latency, fewer licenses, fewer moving parts.
- **Secret handling**: Key Vault-backed secret environment variable (`crd_ClientSecret`) preferred; plain environment variable (`crd_ClientSecretPlain`) as a documented fallback.

## Prerequisites

- Dynamics 365 Customer Service with unified routing
- Conversation diagnostics exported to Application Insights ([Microsoft docs](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/configure-conversation-diagnostics)) — needs a managed environment
- An Entra app registration with **Reader** on the App Insights resource or Log Analytics workspace
- System Administrator to import the solution

## Install

1. Download the latest managed solution from [Releases](../../releases).
2. Import into your environment.
3. Run `deploy/register-customapis.ps1 -EnvironmentUrl https://yourorg.crm4.dynamics.com` (one-time, until the Custom APIs ship inside the solution).
4. Open the **Diagnostics Settings** page and fill in tenant id, client id, secret and the App Insights App ID (or workspace id). Hit **Test connection**.
5. Add the **Conversation Analyzer** tool to your app profile's productivity pane — same steps as any productivity tool, see [docs/setup-app-profile.md](docs/setup-app-profile.md).

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

## Build locally

```powershell
./build.ps1
# output: solution/bin/Release/ConversationDiagnostics.zip (+ _managed.zip)
```

## Roadmap

- [ ] Capture Custom APIs and custom pages into the solution src (removes the registration script step)
- [ ] Assignment snapshot support (eligible-agent breakdown per assignment cycle)

## License

MIT. KQL query texts originate from Microsoft's FastTrack Implementation Assets (MIT).

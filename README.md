# Conversation Diagnostics for Dynamics 365

**See why unified routing did what it did, without handing anyone an Azure login.**

Microsoft moved routing diagnostics out of Dynamics and into Azure Application Insights. Fine if you have an Azure subscription open on the other monitor. Useless for the supervisors and admins who live in Customer Service workspace and have no business getting Azure RBAC.

So I brought the diagnostics back into Dynamics.

## What you get

| Component | What it does |
|---|---|
| **Routing Overview** | Replica of the Microsoft FastTrack "Conversation Diagnostics" dashboard. Incoming work items, with classification, route-to-queue, assignment and timeline panels that cross-filter when you pick a row. Plus problem spotlights: fallback routing, overflow, repeat rejections, slow assignment, long handle times. |
| **Explain this routing** | Pick a work item on the overview, press the button, and read a plain-language account of every routing decision in place. Which rule set ran, which rule matched on which condition, which queue resulted, which agent got picked and why. |
| **Conversation Analyzer** | Same explanation for a single conversation. Paste the ID or the URL from the Copy link button. Available as a page and as a productivity pane tool. |
| **Settings page** | Tenant ID, client ID, secret, App Insights App ID. An admin fills this in once. Nobody else touches Azure. |

The explanation engine is deterministic and rule-based. Every sentence maps 1:1 to a telemetry fact. No AI in the read path, so nothing invents a routing decision that never happened.

## How it works

```
CSW / custom pages                      Dataverse                         Azure
┌────────────────────────┐    ┌───────────────────────────┐    ┌─────────────────────────┐
│ Routing Overview (PCF) │    │ Custom APIs (pwr_*)        │    │ Application Insights     │
│ Conversation Analyzer  │───▶│ Plugin: named KQL library, │───▶│ query API                │
│ (PCF, also in the      │    │ client-credentials auth,   │    │ (client credentials,     │
│  productivity pane)    │    │ secret from Key Vault-     │    │  Reader role)            │
└────────────────────────┘    │ backed env var             │    └─────────────────────────┘
                              └───────────────────────────┘
```

Three decisions worth calling out:

- **Users pass query keys, never raw KQL.** The KQL sits server-side in the plugin (`QueryLibrary.cs`), taken from the [Microsoft FastTrack Conversation Diagnostics dashboard](https://github.com/microsoft/Dynamics-365-FastTrack-Implementation-Assets/tree/master/Customer%20Service/Customer%20Service/ComponentLibrary/AppInsights-Telemetry/ConversationDiagnostics). Nobody can query your workspace beyond what the solution exposes.
- **No Power Automate, no premium connectors, no staging tables.** The plugin calls the query API directly. Lower latency, fewer licences, fewer moving parts than the alternatives I looked at.
- **The plugin runs as SYSTEM.** That is the point: users need zero Azure permissions. It also makes the Custom APIs your access boundary, so gate them with a privilege before you go past a pilot.

## Prerequisites

- Dynamics 365 Customer Service with unified routing
- Conversation diagnostics exported to Application Insights ([Microsoft docs](https://learn.microsoft.com/en-us/dynamics365/customer-service/administer/configure-conversation-diagnostics)) — needs a managed environment
- An Entra app registration with the **Reader** role on the Application Insights resource
- System Administrator on the target environment

## Install

Two routes. Pick one.

### Route A — install the release (recommended)

You want the tool working. You do not care about the source.

1. Grab the latest `ConversationDiagnostics_managed.zip` from [Releases](../../releases).
2. Import it into your environment.
3. Work through **[docs/post-import-setup.md](docs/post-import-setup.md)**.

The solution carries the two controls, the environment variables, the plug-in assembly and the three Custom APIs, so the import handles all of that. What is left is configuration and the pieces a solution cannot carry without trampling your own apps:

| Step | What |
|---|---|
| 1 | Turn on **Power Apps component framework for canvas apps** |
| 2 | Confirm telemetry reaches Application Insights |
| 3 | Create the Entra app registration, grant Reader, copy the App ID ([docs/setup-azure.md](docs/setup-azure.md)) |
| 4–5 | Already done by the import — each step has a check to confirm |
| 6–7 | Add the settings page, fill it in, press **Test connection** |
| 8–9 | Build the custom pages and add them to your apps |
| 10 | Register the productivity pane tool ([docs/setup-app-profile.md](docs/setup-app-profile.md)) |
| 11 | Lock down who can call the Custom APIs |

Budget 45–60 minutes the first time.

### Route B — build from source

You want to change something, or you would rather compile it yourself.

```powershell
git clone https://github.com/<you>/d365-conversation-diagnostics.git
cd d365-conversation-diagnostics
./build.ps1
```

You need the .NET SDK, Node.js 20+, and the pac CLI:

```powershell
dotnet tool install --global Microsoft.PowerApps.CLI.Tool
pac auth create --environment https://yourorg.crm4.dynamics.com
```

Output lands in `solution/bin/Release/`. Then follow the same runbook from step 1.

Build and push in one go:

```powershell
./build.ps1 -Import                  # build, import, publish
./build.ps1 -BumpControls -Import    # my usual loop
./deploy/import-solution.ps1         # import an existing build
./deploy/capture-solution.ps1        # pull portal-made changes back into solution/src
```

Use `capture-solution.ps1` after adding anything through the maker portal. It exports, unpacks over `solution/src`, and warns you if environment variable values came along — those carry your tenant configuration and should never reach source control.

`-BumpControls` increments the patch version in both control manifests. Do that whenever you change PCF code, or the import will keep the old control.

## Two things that catch everyone out

1. **Enable "Power Apps component framework for canvas apps"** on the environment before step 8. Custom pages are canvas-based, and if the setting is off the Code tab is simply empty, with no error to tell you why.
2. **Bump the control versions when you change PCF code.** Dataverse only refreshes a code component when its version number changes, so reimporting at the same version quietly keeps the old control running and it looks like your change did nothing.

## Repository layout

| Path | Contents |
|---|---|
| `src/plugin` | C# plugin: 3 Custom APIs, config reader, App Insights query client, KQL library |
| `src/controls/ConversationAnalyzer` | PCF: timeline, metrics and the explanation engine |
| `src/controls/RoutingOverview` | PCF: FastTrack dashboard replica with cross-filtering and inline explanations |
| `src/webresources` | Settings page |
| `src/queries` | The 12 FastTrack KQL queries as standalone `.kql` files, for reference |
| `solution` | `cdsproj` solution project, builds managed and unmanaged |
| `deploy` | Plugin registration, Custom API registration, solution import and capture scripts |
| `.github/workflows` | Tag `v*` → build → GitHub release |
| `docs` | [post-import-setup.md](docs/post-import-setup.md), [setup-azure.md](docs/setup-azure.md), [setup-app-profile.md](docs/setup-app-profile.md), [architecture.md](docs/architecture.md) |

## About the npm audit warnings

`npm install` reports 9 vulnerabilities in the PCF controls. They are understood, not ignored:

| Count | Root package | What it is |
|---|---|---|
| 4 high | `pcf-start` → `browser-sync` → `immutable` | Microsoft's local test harness, used by `npm start` |
| 5 moderate | `pcf-scripts` → `applicationinsights` → `@opentelemetry/*` | Telemetry inside Microsoft's build tool |

Things worth knowing:

- **Zero production vulnerabilities.** `npm audit --omit=dev` returns nothing. None of this reaches the built bundle or your users. The risk surface is a developer machine running the local harness.
- **Both roots are Microsoft's own packages.** The versions are pinned by `pcf-scripts` and `pcf-start`, so they clear when Microsoft ships updates, not when you run a command.
- **`npm audit fix` does not resolve them** and `--force` would move `pcf-scripts` off the version the build needs. Leave them.

If you never run the local test harness, dropping `pcf-start` from `devDependencies` removes the four highs. It also removes `npm start`, so that is a trade rather than a fix.

## Known limits

- **The productivity pane cannot read the session.** Microsoft documents that custom productivity tools are not bound to the session context, so the pane cannot tell which conversation is on screen. Paste the ID, or the URL from the Copy link button. I pulled the auto-detection out: it worked just often enough to look reliable, which is worse than not working at all.
- **Custom pages reject extra URL parameters.** That is why the overview explains routing in place instead of deep linking to the analyzer page.
- **Application Insights only.** The FastTrack KQL uses App Insights schema (`traces`, `timestamp`, `customDimensions`). The Log Analytics workspace API uses different names, so it would need a parallel query set. Workspace-based App Insights resources work fine.
- **Custom pages are manual on first setup.** Power Apps generates their logical names with a random suffix, so capture them into the solution afterwards (step 13) if you want the next environment to be a straight import.

## Roadmap

- [ ] Assignment snapshot support: eligible-agent breakdown per assignment cycle
- [ ] One-click installer page
- [ ] Sovereign cloud endpoints (GCC, Mooncake)
- [ ] Case → conversation lookup so a case session can find its conversation

## Credits and licence

The KQL queries come from Microsoft's [FastTrack Implementation Assets](https://github.com/microsoft/Dynamics-365-FastTrack-Implementation-Assets) (MIT). Repo structure and the productivity pane approach follow the pattern Mauricio Oliveira uses in [Presence Hub](https://github.com/moliveirapinto/Presence-Hub), which is worth your time if you run Customer Service.

MIT.

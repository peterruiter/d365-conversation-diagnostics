# Architecture notes

## Why a plugin and not Power Automate
The Azure Monitor Logs connector needs a premium license and a connection owner with workspace RBAC, plus a staging table and cleanup flow. A plugin calling the query REST API with client credentials removes all of that: one app registration, one secret, direct response, ~1-3 s latency.

## Security model
- Client passes a **query key** from a fixed server-side registry (`QueryLibrary.cs`). Raw KQL from the client is rejected by design.
- Parameters are typed and validated: `TimeRangeHours` clamped, `WorkItemId`/`ConversationId` must parse as GUIDs before they touch the query. No string concatenation of untrusted input.
- The plugin runs data access as SYSTEM; gate access to the Custom APIs with a privilege (`executeprivilegename`) tied to a security role if you need to restrict who can run diagnostics.

## Query flow
1. PCF calls `pwr_ExecuteDiagnosticsQuery` / `pwr_GetConversationDiagnostics` via `Xrm.WebApi.execute`.
2. Plugin reads config from environment variables; secret via `RetrieveEnvironmentVariableSecretValue` (Key Vault) with plain-variable fallback.
3. Client-credentials token against `login.microsoftonline.com`, scope `api.applicationinsights.io/.default`.
4. POST to the query endpoint with the bound KQL and an ISO 8601 timespan.
5. Raw tables/rows JSON returns to the PCF; parsing and rendering happen client-side.

## The explanation engine
`explainEngine.ts` folds the ordered subscenario stream into:
- **Steps**: normalized timeline entries with status coloring and raw-event drill-down.
- **Narrative**: one sentence per fact — which rule set ran, which rule matched on which condition, which output applied, which queue resulted, which agent was selected and why (assignment method + capacity + presence), rejections, overflow, fallback.
- **Metrics**: time to accept, handle time, total duration, final queue, rejection count.
- **Warnings**: fallback queue used, no eligible agent, >2 min assignment, >5 min handle time, ≥2 rejections.

Subscenario names vary slightly across channels and product waves; the engine matches on both old and new names (`CSRAccepted`/`AgentAccept`, etc.). Extend the switch in one place when Microsoft adds events.

## What ships where

The solution zip carries the two PCF controls and the environment variable definitions. The plugin assembly is registered separately with the Plugin Registration Tool, and the Custom APIs are created by `deploy/register-customapis.ps1`. The settings web resource and the two custom pages are added by hand on first setup, then captured into the solution on the next export. Full sequence in [post-import-setup.md](post-import-setup.md).

The plugin sits outside the *build* on purpose: referencing a plugin csproj from the cdsproj trips Microsoft build-tools issues #959 and #1232 (assembly registration configuration errors during packaging). It still belongs *in* the shipped solution — add it via the maker portal and capture it on export, so consumers install one zip.

**Assembly naming.** `AssemblyName` is `ConversationDiagnosticsPlugins`, deliberately without dots, because the solution packager mangles dotted assembly names (issue #1232). The C# namespaces remain `ConversationDiagnostics.Plugins.*`, so plugin type full names are unaffected. Anything that looks the assembly up by name — `deploy/register-customapis.ps1`, PRT, the maker portal — must use the dot-free form.

## Productivity pane constraint

Custom productivity tools are registered as pane tool configuration records (Copilot Service admin center → Productivity → Productivity tools), then enabled per experience profile. Microsoft documents that these tools are **not contextually bound to the session** and have **no supported mechanism to retrieve session context**. The analyzer therefore treats auto-resolution as best-effort and always keeps its manual search box. Anything that depends on reading the active conversation from the pane is building on unsupported ground.

Note also that a session id is not a conversation id. Only the session *context* carries the live work item, which is why `resolveFromSession` reads `getContext()` rather than `sessionId`.

**No entity scoping.** `msdyn_panetoolconfiguration` has no field binding a tool to a table or session type. The only lever is `Global` (Yes = everywhere including the home session, No = within sessions). A custom tool cannot be limited to conversation sessions through configuration; if that matters, the control has to render its own empty state when no conversation is in context.

## Known gaps
- Custom APIs registered by script until captured into solution src.
- `register-customapis.ps1` depends on the Azure CLI for token acquisition.
- `pac plugin push` cannot perform the initial assembly registration (its `--pluginId` is required and only exists post-registration), so first-time setup goes through PRT.
- Custom pages (.msapp) must be authored once in a dev environment; they cannot be authored as code.
- The FastTrack "Fallback Queue Routing" query hardcodes a queue display name ("Case Question Queue") — parameterize it for your org in `QueryLibrary.cs`.
- Sovereign clouds need different login/query endpoints; not wired up yet.
- The productivity pane tool cannot reliably auto-detect the active conversation (see above). Case → conversation lookup would not solve it either; the constraint is session context, not the lookup.
- Application Insights is the only supported query surface. The Log Analytics workspace API uses a different schema (`AppTraces` / `TimeGenerated` / `Properties` instead of `traces` / `timestamp` / `customDimensions`), so supporting it would need a parallel query set in `QueryLibrary.cs`. Workspace-based Application Insights resources are fine: the App Insights API reads the same underlying data.

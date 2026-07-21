# Architecture notes

## Why a plugin and not Power Automate
The Azure Monitor Logs connector needs a premium license and a connection owner with workspace RBAC, plus a staging table and cleanup flow. A plugin calling the query REST API with client credentials removes all of that: one app registration, one secret, direct response, ~1-3 s latency.

## Security model
- Client passes a **query key** from a fixed server-side registry (`QueryLibrary.cs`). Raw KQL from the client is rejected by design.
- Parameters are typed and validated: `TimeRangeHours` clamped, `WorkItemId`/`ConversationId` must parse as GUIDs before they touch the query. No string concatenation of untrusted input.
- The plugin runs data access as SYSTEM; gate access to the Custom APIs with a privilege (`executeprivilegename`) tied to a security role if you need to restrict who can run diagnostics.

## Query flow
1. PCF calls `crd_ExecuteDiagnosticsQuery` / `crd_GetConversationDiagnostics` via `Xrm.WebApi.execute`.
2. Plugin reads config from environment variables; secret via `RetrieveEnvironmentVariableSecretValue` (Key Vault) with plain-variable fallback.
3. Client-credentials token against `login.microsoftonline.com`, scope `api.applicationinsights.io/.default` or `api.loganalytics.io/.default`.
4. POST to the query endpoint with the bound KQL and an ISO 8601 timespan.
5. Raw tables/rows JSON returns to the PCF; parsing and rendering happen client-side.

## The explanation engine
`explainEngine.ts` folds the ordered subscenario stream into:
- **Steps**: normalized timeline entries with status coloring and raw-event drill-down.
- **Narrative**: one sentence per fact — which rule set ran, which rule matched on which condition, which output applied, which queue resulted, which agent was selected and why (assignment method + capacity + presence), rejections, overflow, fallback.
- **Metrics**: time to accept, handle time, total duration, final queue, rejection count.
- **Warnings**: fallback queue used, no eligible agent, >2 min assignment, >5 min handle time, ≥2 rejections.

Subscenario names vary slightly across channels and product waves; the engine matches on both old and new names (`CSRAccepted`/`AgentAccept`, etc.). Extend the switch in one place when Microsoft adds events.

## Known gaps
- Custom APIs registered by script until captured into solution src.
- Custom pages (.msapp) must be authored once in a dev environment; they cannot be authored as code.
- The FastTrack "Fallback Queue Routing" query hardcodes a queue display name ("Case Question Queue") — parameterize it for your org in `QueryLibrary.cs`.
- Sovereign clouds need different login/query endpoints; not wired up yet.

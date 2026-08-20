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

**The plugin belongs in the shipped solution, but not as a cdsproj project reference.** Two different things, easy to conflate:

- *In the solution*: yes. Add the registered assembly through the maker portal and capture it on export. Consumers then install one zip and the import registers the assembly for them.
- *As a `<ProjectReference>` from the cdsproj*: no. That path trips Microsoft build-tools issues #959 and #1232, which fail packaging with assembly registration configuration errors.

So `build.ps1` compiles the plugin separately, then overwrites the copy captured under `solution/src` before packing. Without that overwrite the packer would ship whatever DLL was last committed.

**Assembly naming.** `AssemblyName` is `ConversationDiagnosticsPlugins`, deliberately without dots, because the solution packager mangles dotted assembly names (issue #1232). The C# namespaces remain `ConversationDiagnostics.Plugins.*`, so plugin type full names are unaffected. Anything that looks the assembly up by name — `deploy/register-customapis.ps1`, PRT, the maker portal — must use the dot-free form.

## Productivity pane constraint

Custom productivity tools are registered as pane tool configuration records (Copilot Service admin center → Productivity → Productivity tools), then enabled per experience profile. The pane is not contextually bound to the session the way a form is — it has to ask, not just look at `context.parameters`.

There are two supported, code-level ways to avoid the pane entirely, and these are the **primary, recommended** routes because they are record-scoped rather than session-scoped — they work identically whether the conversation is open, closed, or a week old. That matters here specifically because Application Insights telemetry lags behind the live conversation, so most real diagnostics lookups happen *after* the conversation has closed, often by a supervisor who was never in that session at all:

1. **Bind the PCF to the Conversation form.** `ConversationAnalyzer` accepts an optional `conversationId` input (`ControlManifest.Input.xml`). Add the control to a `msdyn_ocliveworkitem` form and bind that input to the record's own ID — the control never needs any session context because it reads the record it's rendered on.
2. **Launch the analyzer page via `Xrm.Navigation.navigateTo`.** `pwr_conversationanalyzer_launch.js` wires a command-bar button that calls `navigateTo({ pageType: "custom", name, entityName: "msdyn_ocliveworkitem", recordId })`. This is Microsoft's documented mechanism for handing a custom page a bound record — see [`navigateTo` reference](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-navigation/navigateto). `RoutingOverview`'s "Open in Conversation Analyzer" button uses the same function (`api.ts#openConversationAnalyzerPage`).

A third, secondary option makes the pane itself auto-fill, but only for a conversation that is genuinely still ongoing — see [Pane auto-fill for live conversations](#pane-auto-fill-for-live-conversations) below.

**No entity scoping.** `msdyn_panetoolconfiguration` has no field binding a tool to a table or session type. The only lever is `Global` (Yes = everywhere including the home session, No = within sessions). A custom tool cannot be limited to conversation sessions through configuration; if that matters, the control has to render its own empty state when no conversation is in context.

## Pane auto-fill for live conversations

**Status: supported, unconditional whenever the control is unbound.** Microsoft documents [`Microsoft.Omnichannel.getConversationId()`](https://learn.microsoft.com/en-us/dynamics365/customer-service/developer/reference/methods/getconversationid) as returning the id of the conversation that is *currently ongoing* in the focused session. Confirmed callable directly from a pane-hosted `ConversationAnalyzer`, via `window.parent`, against a real live agent session — no relay, no form-side companion script.

`liveSessionAutoFill.ts` calls that API directly on load, and again on Microsoft's own documented [`ON_SESSION_SWITCH`](https://learn.microsoft.com/en-us/dynamics365/customer-service/develop/reference/events/on_session_switch) event (subscribed the same way, via `Microsoft.Apm.getEventPublisherTopic("ON_SESSION_SWITCH")`, directly from the pane) so switching into a different live session re-triggers the lookup — the pane persists across session switches, so nothing in the PCF's own `init()`/`updateView()` lifecycle would otherwise notice. It runs whenever `init()` finds no bound `conversationId` and no `?pwr_id` — which in practice only ever happens when the control is hosted as a pane tool, since both the custom page and a form binding always resolve an id before this code path is reached.

It never overrides a manually-typed id: typing or pasting into the search box sets a `manualOverride` flag immediately (on the input's own `input` event, before Analyze is even pressed), which stops the poll loop and makes `onAutoFillId` a no-op from then on for that control instance. An earlier version also showed a labeled "Auto-detected…" banner with a separate "Clear, use manual search" button; it was removed because it added a step that was never actually necessary — the search box itself is always live and always wins the moment you type or paste into it, so a button whose only job was to let you do that first was pure friction.

**Why this is not an opt-in control property.** An earlier version gated this behind an `enablePaneAutoFill` input property, toggled on the pane tool's PCF configuration. That configuration screen doesn't exist for this purpose: `msdyn_panetoolconfiguration` (the "Pane tool configuration" record a **Control**-type pane tool is registered with) has no field to set a custom control's input properties at all — the maker UI only exposes Name, Unique Name, Type, Control Name, Icon, Global, Description, and Learn More Link. A toggle there would be permanently stuck at its manifest default, in the one host it was meant to matter for. So the property was removed and the behavior made unconditional for the unbound case instead.

**Why this replaced an earlier same-origin `BroadcastChannel` relay.** Before that, an even earlier version assumed a pane-hosted control had no way to reach `Microsoft.Omnichannel`/`Microsoft.Apm` at all, and worked around that with a separate form-side web resource (`pwr_conversationcontext_bridge.js`) that read its own record's context and re-broadcast it to the pane over a repo-owned `BroadcastChannel` topic, with a custom message schema, a freshness TTL, and focus-matching to compensate for the relay's own staleness risk. Testing against a live environment showed the pane can call `Microsoft.Omnichannel.getConversationId()` directly, which made all of that unnecessary: Microsoft's own API already answers "what's ongoing right now," so every check is either current or empty — there is nothing left to go stale. The relay, its web resource, and the message-validation layer were removed rather than kept as a fallback, since keeping two implementations of the same narrow live-session convenience wasn't worth the surface area.

**Why this is not the primary route.** `getConversationId()` only ever resolves for a genuinely ongoing conversation. The moment that conversation closes — the common case here, since App Insights telemetry lags behind the live session — it resolves to nothing. That is not a limitation to work around; it's what the API is for. Looking up a closed conversation's diagnostics needs one of the two record-scoped routes above.

### Security notes

- The id this surfaces is not access-controlled beyond what Dataverse already enforces on the diagnostics query itself: the Custom API still validates the id as a GUID and queries Application Insights the same way regardless of where the id came from, manual or auto-filled.
- `Microsoft.Omnichannel` requires an Omnichannel/digital-messaging license, consistent with the rest of this solution's assumption of unified routing.

### Disabling it

There is no control property to flip. If a deployment genuinely needs the pane to never call this API, the only lever is code: remove the `else { this.startAutoFill(); }` branch in `ConversationAnalyzer/index.ts`'s `init()` and rebuild. Manual paste and the record-scoped routes are unaffected either way — this is purely a convenience layered on top of them.

## Known gaps
- Custom APIs registered by script until captured into solution src.
- `register-customapis.ps1` depends on the Azure CLI for token acquisition.
- `pac plugin push` cannot perform the initial assembly registration (its `--pluginId` is required and only exists post-registration), so first-time setup goes through PRT.
- Custom pages (.msapp) must be authored once in a dev environment; they cannot be authored as code — which is also why the `Param("recordId")`/`Param("entityName")` wiring for the supported `navigateTo` route on the analyzer custom page is a documented manual step ([docs/setup-app-profile.md](setup-app-profile.md)) rather than a shipped binary edit.
- The FastTrack "Fallback Queue Routing" query hardcodes a queue display name ("Case Question Queue") — parameterize it for your org in `QueryLibrary.cs`.
- Sovereign clouds need different login/query endpoints; not wired up yet.
- The productivity pane tool cannot auto-detect a *closed* conversation (see above); pane auto-fill only ever covers a genuinely ongoing one. The record-scoped routes (form binding / `navigateTo`) are what cover a closed conversation.
- Application Insights is the only supported query surface. The Log Analytics workspace API uses a different schema (`AppTraces` / `TimeGenerated` / `Properties` instead of `traces` / `timestamp` / `customDimensions`), so supporting it would need a parallel query set in `QueryLibrary.cs`. Workspace-based Application Insights resources are fine: the App Insights API reads the same underlying data.

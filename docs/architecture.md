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

Custom productivity tools are registered as pane tool configuration records (Copilot Service admin center → Productivity → Productivity tools), then enabled per experience profile. Microsoft documents that these tools are **not contextually bound to the session** and have **no supported mechanism to retrieve session context**. That fact hasn't changed and this repo doesn't claim otherwise — the pane tool's manual search box stays the primary, always-available path.

What has changed is that there are now two supported, code-level ways to avoid the pane limitation entirely by not routing through the pane at all, plus one experimental, opt-in way to make the pane itself auto-fill:

1. **Bind the PCF to the Conversation form.** `ConversationAnalyzer` accepts an optional `conversationId` input (`ControlManifest.Input.xml`). Add the control to a `msdyn_ocliveworkitem` form and bind that input to the record's own ID — the control never needs the pane's session context because it is rendered on the record itself.
2. **Launch the analyzer page via `Xrm.Navigation.navigateTo`.** `pwr_conversationanalyzer_launch.js` wires a command-bar button that calls `navigateTo({ pageType: "custom", name, entityName: "msdyn_ocliveworkitem", recordId })`. This is Microsoft's documented mechanism for handing a custom page a bound record — see [`navigateTo` reference](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-navigation/navigateto) — and is unrelated to, and unaffected by, the pane's lack of session context. `RoutingOverview`'s "Open in Conversation Analyzer" button uses the same function (`api.ts#openConversationAnalyzerPage`).
3. **Experimental: a same-origin context bridge for the pane tool.** See [Experimental context bridge](#experimental-context-bridge) below. This is the only one of the three that changes what the *pane* itself can do, and it does so without contradicting Microsoft's documented limitation: the pane still has no supported API to read session context, so the bridge is a form-side broadcaster the pane optionally listens to, entirely outside Microsoft's session-context APIs.

Note also that a session id is not a conversation id. Only the session *context* carries the live work item id, which is why the experimental bridge publishes both `conversationId` and `sessionId` and requires the analyzer to match the currently-focused session (see below) rather than trusting the first message it sees.

**No entity scoping.** `msdyn_panetoolconfiguration` has no field binding a tool to a table or session type. The only lever is `Global` (Yes = everywhere including the home session, No = within sessions). A custom tool cannot be limited to conversation sessions through configuration; if that matters, the control has to render its own empty state when no conversation is in context.

## Experimental context bridge

**Status: opt-in, off by default, not a Microsoft-supported feature.** This section documents what it does, exactly why it's labeled experimental rather than supported, and how to turn it off if it ever misbehaves.

### Why this needs its own section

The pane tool genuinely has no supported way to read session context — that's the constraint above, and it's real. Microsoft *does*, however, publish two things this bridge builds on without touching the pane's session context APIs at all:

- [`Microsoft.Apm`](https://learn.microsoft.com/en-us/dynamics365/customer-service/develop/microsoft-apm), a documented client API surface for productivity tools running in Customer Service workspace.
- The [`ON_SESSION_SWITCH`](https://learn.microsoft.com/en-us/dynamics365/customer-service/develop/reference/events/on_session_switch) event, which Microsoft itself documents as delivered over a `BroadcastChannel` obtained from `Microsoft.Apm.getEventPublisherTopic("ON_SESSION_SWITCH")`. Same-origin `BroadcastChannel` for cross-iframe/cross-document messaging is Microsoft's own pattern here, not something this repo invents.

So the bridge does **not** attempt to read the pane's session context directly (no `window.parent` scraping, no undocumented reads). Instead:

- A **form-side web resource**, `pwr_conversationcontext_bridge.js`, wired to the `msdyn_ocliveworkitem` form's `OnLoad`/`OnSave`/`OnUnload` events, knows the current record's ID (that's just the form context — fully supported) and best-effort reads the associated App Profile Manager session ID via `Microsoft.Apm.getFocusedSession()`.
- It publishes a small, versioned message (`{ v: 1, type: "state", conversationId, sessionId, focused, ts }`) on its **own** same-origin `BroadcastChannel` topic (`pwr.conversationcontext.v1`) — a channel this repo owns, not Microsoft's `ON_SESSION_SWITCH` channel.
- It separately subscribes to Microsoft's `ON_SESSION_SWITCH` topic (via `Microsoft.Apm.getEventPublisherTopic`) purely to know when *this form's* session gains or loses focus, and folds that into the `focused` flag it publishes on its own topic.
- It answers `{ type: "request" }` handshake messages so a newly-opened pane can ask "what's current?" instead of waiting for the next form event.
- The `ConversationAnalyzer` PCF's `contextBridge.ts` listens on `pwr.conversationcontext.v1` **only when the `enableContextBridge` control property is turned on**, validates every message (schema version, message type, GUID shape via the same `GUID_RE` used for manual/URL input, a 5-second freshness TTL), requires the message's session to be the one currently focused, and drops anything that doesn't pass — without ever hiding or disabling the manual search box.

### Was layering a custom channel on Microsoft's `ON_SESSION_SWITCH` channel evaluated?

Yes. Two options were considered for how the pane learns the conversation ID:

1. **Have the pane PCF listen to Microsoft's `ON_SESSION_SWITCH` `BroadcastChannel` directly.** Rejected: that event's payload is `previousSessionId`/`newSessionId` only — no conversation/work item ID — so the pane would still need another source for the actual conversation ID, and piggy-backing extra semantics onto a channel Microsoft owns and versions independently is exactly the kind of unsupported coupling this task said to avoid.
2. **A separate, repo-owned `BroadcastChannel` topic, published by a form-side web resource that itself listens to `ON_SESSION_SWITCH` for focus tracking** (what's implemented). This keeps the dependency on Microsoft's undocumented-guarantee behavior isolated to one small file (`pwr_conversationcontext_bridge.js`), on one topic this repo controls and versions (`v: 1`), with the PCF side only ever trusting its own schema.

`BroadcastChannel` is same-origin only — both the form-side web resource and the pane tool run inside the same Dynamics origin, so this is within its constraints. What Microsoft does **not** guarantee is that a productivity pane's iframe and a form's iframe stay in the same browsing context group / are guaranteed to receive each other's `BroadcastChannel` messages across all hosting scenarios (embedded canvas apps, mobile clients, future changes to how panes are hosted). That's the compatibility risk this whole feature is opt-in and clearly labeled against — it works in standard Customer Service workspace in a browser today, and there is no Microsoft commitment that it keeps working.

### Message validation and staleness handling

- **Schema**: `{ v: 1, type: "state" | "request", conversationId?, sessionId?, focused?, ts }`. Unknown `v` or `type`, or a payload that doesn't match, is dropped.
- **GUID validation**: `conversationId`/`sessionId` must match the same GUID pattern (`GUID_RE`) used for manual paste and `?pwr_id`, braces optional.
- **Freshness/TTL**: messages older than 5 seconds (`FRESHNESS_TTL_MS`) at receipt are rejected — a stale message from a session that has since navigated away must not silently populate the analyzer.
- **Focus matching**: the analyzer only accepts state for the session currently reported as focused; a message from a backgrounded session is ignored so switching sessions in the pane doesn't leave the wrong conversation loaded.
- **Manual override wins, always**: typing in the search box, pressing Analyze, or pressing Clear marks the session `manualOverride = true`; the bridge keeps running (so the banner state stays accurate) but never overwrites a manual choice.
- **Visible labeling**: any bridge-supplied ID shows a labeled banner ("Loaded from conversation context (experimental)") with a one-click "Clear, use manual search" action. Bridge errors surface as a small distinct error state — errors are never swallowed silently, per the existing pattern of surfacing failures in this control's UI rather than only in the console.
- **Cleanup**: `destroy()` closes the `BroadcastChannel` and drops the pane-side listener; the form-side web resource closes both of its channels in `OnUnload`.

### Security and staleness risks

- **Same-origin, not same-tenant-record-security.** `BroadcastChannel` messages are visible to any same-origin script, not access-controlled by Dataverse security roles. Do not put anything beyond a conversation/session ID (already visible in the URL/session anyway) on this channel.
- **A message is a hint, not a source of truth.** The plugin/Custom API calls the analyzer makes are unaffected — they still validate the ID as a GUID before querying Application Insights, same as manual input.
- **Stale/mismatched session risk is why this is capped at 5 seconds and matched against focus.** Without both checks, a slow tab, a suspended background tab, or a fast sequence of session switches could feed the analyzer a conversation ID for a session the agent is no longer looking at.
- **No guarantee across all hosting surfaces.** Mobile client, embedded/iframe-in-iframe hosting, or a future Microsoft change to how the pane is rendered could silently stop delivering these messages. Because the pane always falls back to manual paste, that failure mode is a return to today's baseline, not a broken UI — but it is still a real limitation worth planning around before relying on this outside a "nice to have."

### Rollback / disable

- **Fastest:** set the `enableContextBridge` control property back to `No` (its default) on the pane tool's PCF configuration. The pane stops listening immediately; manual paste is unaffected.
- **Full removal:** unwire `Pwr.ConversationContextBridge.onLoad` / `onSave` / `onUnload` from the `msdyn_ocliveworkitem` form's event handlers, then optionally remove the `pwr_conversationcontext_bridge` web resource. No Dataverse schema, plugin, or Custom API changes are involved, so this is a pure client-side revert.

## Known gaps
- Custom APIs registered by script until captured into solution src.
- `register-customapis.ps1` depends on the Azure CLI for token acquisition.
- `pac plugin push` cannot perform the initial assembly registration (its `--pluginId` is required and only exists post-registration), so first-time setup goes through PRT.
- Custom pages (.msapp) must be authored once in a dev environment; they cannot be authored as code — which is also why the `Param("recordId")`/`Param("entityName")` wiring for the supported `navigateTo` route on the analyzer custom page is a documented manual step ([docs/setup-app-profile.md](setup-app-profile.md)) rather than a shipped binary edit.
- The FastTrack "Fallback Queue Routing" query hardcodes a queue display name ("Case Question Queue") — parameterize it for your org in `QueryLibrary.cs`.
- Sovereign clouds need different login/query endpoints; not wired up yet.
- The productivity pane tool has no *supported* way to auto-detect the active conversation (see above); the experimental context bridge narrows, but does not remove, that gap, and is intentionally opt-in rather than default-on.
- Application Insights is the only supported query surface. The Log Analytics workspace API uses a different schema (`AppTraces` / `TimeGenerated` / `Properties` instead of `traces` / `timestamp` / `customDimensions`), so supporting it would need a parallel query set in `QueryLibrary.cs`. Workspace-based Application Insights resources are fine: the App Insights API reads the same underlying data.

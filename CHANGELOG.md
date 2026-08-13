# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Supported route to a bound conversation.** `ConversationAnalyzer` can be hosted directly on the `msdyn_ocliveworkitem` Conversation form, or launched already bound to the current conversation via `Xrm.Navigation.navigateTo`'s documented `pageInput.recordId`/`pageInput.entityName` mechanism (read on the custom page via `Param("recordId")`/`Param("entityName")`). `RoutingOverview` gained an **Open in Conversation Analyzer** button using this route (`api.ts#openConversationAnalyzerPage`); a new `pwr_conversationanalyzer_launch.js` web resource exposes the same call for a command-bar button on the Conversation form. Both need the new `pwr_ConversationAnalyzerPageName` environment variable, configurable from the settings page.
- **Experimental, opt-in context bridge for the productivity pane.** A new form-side web resource, `pwr_conversationcontext_bridge.js`, publishes the current conversation/session id over a same-origin `BroadcastChannel` and tracks session focus via Microsoft's own `Microsoft.Apm`/`ON_SESSION_SWITCH` event. `ConversationAnalyzer` gained a matching `contextBridge.ts` client and a new `enableContextBridge` control property (off by default) that, when turned on, listens for these messages, validates them (schema version, GUID shape, freshness/TTL, focused-session match), and shows a labeled banner with a one-click way back to manual search. Manual paste is never disabled or hidden by this feature. Full risk assessment, rollback steps and Microsoft doc links in `docs/architecture.md` and `docs/setup-app-profile.md`.

### Changed

- Corrected the "custom pages reject extra URL parameters" known limit to distinguish arbitrary query-string parameters (rejected) from `navigateTo`'s `recordId`/`entityName` inputs (supported, and now used by the routes above).
- Both PCF controls bumped to `1.0.3`.

## [1.0.0] - 2026-07-22

First public release.

### Added

- **Routing Overview** control. Replica of the Microsoft FastTrack "Conversation Diagnostics" dashboard, running inside Dynamics. Incoming work items grid with classification, route-to-queue, assignment and timeline panels that cross-filter on row selection, plus seven problem spotlights: conversation state flow, fallback queue routing, overflow, repeat rejections, slow assignment, long handle times, and top rejecting agents.
- **Inline routing explanations.** Select a work item and press **Explain this routing** for a plain-language account of every decision, rendered in place. Deterministic and rule-based: each sentence maps to a telemetry fact, with no AI in the read path.
- **Conversation Analyzer** control. Timeline, metrics and explanation for a single conversation. Accepts a conversation ID, a braced GUID, or a record URL copied with the Copy link button. Runs as a custom page and as a productivity pane tool.
- **Three Custom APIs** (`pwr_ExecuteDiagnosticsQuery`, `pwr_GetConversationDiagnostics`, `pwr_TestDiagnosticsConnection`) backed by a C# plugin that queries the Application Insights REST API with client-credentials auth. Callers pass a query key from a server-side registry, never raw KQL.
- **Settings page** for tenant ID, client ID, secret and Application Insights App ID, with a **Test connection** button that exercises the full path and reports the specific failure.
- **Secret handling** via a Key Vault-backed environment variable (`pwr_ClientSecret`), with a plain variable (`pwr_ClientSecretPlain`) as a documented fallback for dev and demo.
- **Build and deploy scripts**: `build.ps1` (with `-BumpControls` and `-Import`), `deploy/import-solution.ps1`, `deploy/push-plugin.ps1`, `deploy/register-customapis.ps1`.
- **GitHub Actions workflow**: tag `v*` to build and publish a release with both solution zips and the plugin assembly.
- **Documentation**: post-import runbook, Azure setup, productivity pane setup, and architecture notes covering the design decisions and platform limits.

### Notes on scope

- Application Insights is the only supported query surface. The FastTrack KQL uses App Insights schema (`traces`, `timestamp`, `customDimensions`); the Log Analytics workspace API uses different table and column names and would need a parallel query set. Workspace-based App Insights resources work without change.
- The productivity pane tool cannot detect the conversation on screen. Microsoft documents that custom productivity tools have no supported access to session context, so the pane takes a pasted ID or URL.
- The plugin assembly is named `ConversationDiagnosticsPlugins` without dots, because the solution packager mangles dotted assembly names. The C# namespaces are unchanged.

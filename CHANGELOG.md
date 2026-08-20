# Changelog

All notable changes to this project are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-20

Thanks to [Marcus Schmidt](https://github.com/MarcusatMicrosoft) for the pull request that started this release — the `navigateTo` route below is his, and testing his original context-bridge design against a live environment is what led to the simpler pane auto-fill it became.

### Added

- **Record-scoped route to a bound conversation — the recommended way in.** `ConversationAnalyzer` can be hosted directly on the `msdyn_ocliveworkitem` Conversation form, or launched already bound to the current conversation via `Xrm.Navigation.navigateTo`'s documented `pageInput.recordId`/`pageInput.entityName` mechanism (read on the custom page via `Param("recordId")`/`Param("entityName")`). Both work identically whether the conversation is open or closed, which matters because Application Insights telemetry lags behind the live session. `RoutingOverview` gained an **Open in Conversation Analyzer** button using this route (`api.ts#openConversationAnalyzerPage`); a new `pwr_conversationanalyzer_launch.js` web resource exposes the same call for a command-bar button on the Conversation form. Both need the new `pwr_ConversationAnalyzerPageName` environment variable, configurable from the settings page.
- **Automatic pane auto-fill for a live conversation.** Whenever `ConversationAnalyzer` is hosted in the productivity pane (i.e. it has no bound/URL id — the only host where that's ever true), it calls Microsoft's documented `Microsoft.Omnichannel.getConversationId()` directly — confirmed working against a real live agent session — and follows session switches via `Microsoft.Apm`'s `ON_SESSION_SWITCH` event, all without a relay or a separate web resource. Needs no configuration: the pane tool's admin config screen (`msdyn_panetoolconfiguration`) has no field to set a custom control's input properties, so this runs unconditionally rather than as a toggle. It only ever resolves an *ongoing* conversation, so the record-scoped routes above remain the primary way to look up a closed one. Since the pane can open before the conversation session finishes loading, it re-checks once a second (`AUTOFILL_POLL_MS`) until the input field holds an id, whether auto-filled or typed — then stops. Never overrides a manually-typed id: typing or pasting into the search box wins immediately, no extra step. Full detail in `docs/architecture.md` and `docs/setup-app-profile.md`.

### Fixed

- Settings page now trims leading/trailing whitespace from every field on save (and when loading an already-saved value), so an accidental trailing space no longer produces a silently-wrong tenant id, client id, App Insights App ID, secret, or page name.
- `build.ps1 -BumpControls` now also bumps the solution's own `<Version>` build number (`solution/src/Other/Solution.xml`), so a control bump always ships as a distinguishable solution version instead of re-exporting the same version number.

### Changed

- Corrected the "custom pages reject extra URL parameters" known limit to distinguish arbitrary query-string parameters (rejected) from `navigateTo`'s `recordId`/`entityName` inputs (supported, and now used by the routes above).
- Both PCF controls bumped; `ConversationAnalyzer` is now `1.0.12`.

### Removed

- The auto-fill "Auto-detected from the open conversation" banner and its separate "Clear, use manual search" button. It added a step that was never necessary — the search box is always live, so typing or pasting into it directly already takes over immediately, with no button to press first.

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

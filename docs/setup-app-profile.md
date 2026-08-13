# Add the Conversation Analyzer to the productivity pane

> This is step 10 of [post-import-setup.md](post-import-setup.md). Start there if you have just imported the solution — several steps must happen first.

Same mechanics as any productivity tool (Presence Hub users will recognize this).

Register the control as a custom productivity tool first, then enable it on an experience profile. It will not show up in the profile until the tool record exists.

**Prerequisite roles:** **Productivity tools administrator** for you, **Productivity tools user** for every supervisor and representative who should see it.

1. Copilot Service admin center → **Productivity** (under Support experience) → **Manage** for Productivity tools → **New**.
2. Fill in the pane tool configuration:
   - Name: `Conversation Analyzer`
   - Unique Name: `pwr_conversationanalyzer`
   - Type: **Control**
   - Control Name: `pwr_ConversationDiagnostics.ConversationAnalyzer` — must match the manifest exactly, or the pane throws `No manifest found`
   - Global: **No** (Yes shows it on the home session too; there is no conversation-only option)
3. Save.
4. Site map → **Workspaces** → **Manage** for Experience profiles → your profile → **Edit** for Productivity pane.
5. Enable **Conversation Analyzer**, save, and assign the profile to your users.

**On session context:** Microsoft documents that custom productivity tools are not contextually bound to the session and have no supported mechanism to read session context. The control's search box is the primary, always-available way to load a conversation — paste the id, or the URL from **Copy link**. See [Getting a conversation into the analyzer without a manual paste](#getting-a-conversation-into-the-analyzer-without-a-manual-paste) below for the supported and experimental alternatives to a manual paste, including an experimental opt-in bridge for this pane tool specifically.

## Getting a conversation into the analyzer without a manual paste

Three options, in order of how much you should trust them. Full design rationale, security notes, and the technical viability assessment for the experimental option are in [docs/architecture.md](architecture.md#experimental-context-bridge).

### Supported: bind or launch the analyzer from the Conversation

**Option 1 — bind the control on the Conversation form.** No code, no risk of overwriting other customizations beyond the one form you choose to edit:

1. Open the `msdyn_ocliveworkitem` (Conversation) main form in the form editor (classic or modern).
2. Insert → **Custom control** → `pwr_ConversationDiagnostics.ConversationAnalyzer`.
3. Bind the control's `conversationId` property to a field that holds the record's own ID, or leave it unbound and rely on `?pwr_id` if you host the form inside a session URL that carries it. (If your form doesn't already expose the record ID as a bindable text value, a calculated/rollup or a small `formContext.data.entity.getId()` OnLoad script into a hidden text field is the usual pattern — this repo does not ship that, since it depends on your form's existing fields.)
4. Save and publish the form.

**Option 2 — a command-bar button that launches the analyzer page bound to the record**, using `pwr_conversationanalyzer_launch.js` (shipped in this solution as a web resource, not wired to any command by default — command bar / ribbon customizations live on your app, and shipping one automatically risks overwriting yours):

1. Confirm the environment variable **Conversation Analyzer Page Name** (`pwr_ConversationAnalyzerPageName`) is set to the unique name of your analyzer custom page (see [Surfacing the pages](#surfacing-the-pages) below for how that page is authored; the same value goes in the settings page equivalent field if you add one).
2. In the command bar designer (or classic ribbon workbench) for the `msdyn_ocliveworkitem` Conversation form or grid, add a button that calls:
   - **Library**: `pwr_conversationanalyzer_launch` (JScript web resource, already in the solution)
   - **Function**: `Pwr.ConversationAnalyzer.openForRecord`
   - **Parameters**: `PrimaryControl` (pass the form context as the first parameter)
   - **Enable rule** (optional, recommended): same library, function `Pwr.ConversationAnalyzer.isConversationRecord`, same `PrimaryControl` parameter — hides the button on non-conversation forms.
3. Publish. Clicking the button opens the analyzer custom page as a side panel already pointed at the current conversation, via `Xrm.Navigation.navigateTo({ pageType: "custom", ..., entityName: "msdyn_ocliveworkitem", recordId })` — the same [officially documented mechanism](https://learn.microsoft.com/en-us/power-apps/developer/model-driven-apps/clientapi/reference/xrm-navigation/navigateto) `RoutingOverview`'s own "Open in Conversation Analyzer" button uses.
4. On the custom page itself, wire the analyzer control's `conversationId` input to `Param("recordId")` (Power Fx, in the page's `OnStart` or the control's property, e.g. `Param("recordId")`). This is a one-time manual step because custom pages are packaged as binary `.msapp` files and can't be authored as code — see [Known gaps](architecture.md#known-gaps).

Both options avoid the pane tool entirely, so neither depends on, nor is limited by, the pane's lack of session context.

### Experimental: opt-in context bridge for the pane tool

**Off by default. Read [docs/architecture.md#experimental-context-bridge](architecture.md#experimental-context-bridge) before enabling this** — it explains exactly why it's experimental, what it can and can't guarantee, and the staleness/security risks.

1. On the `msdyn_ocliveworkitem` form, add a JavaScript web resource dependency on `pwr_conversationcontext_bridge` and wire:
   - `OnLoad` → `Pwr.ConversationContextBridge.onLoad` (pass execution context)
   - `OnSave` → `Pwr.ConversationContextBridge.onSave` (pass execution context)
   - `OnUnload` (form Events tab, "Off/On Unload") → `Pwr.ConversationContextBridge.onUnload` (pass execution context)

   Publish the form.
2. On the pane tool's PCF configuration (the same control properties surfaced in Insert → Custom control, or on the `msdyn_panetoolconfiguration` record's control properties), turn the new **`enableContextBridge`** property to **Yes**. It defaults to **No**, so nothing changes until you do this.
3. Open a conversation session. On session focus, the form-side web resource publishes the conversation and session ID on a same-origin `BroadcastChannel`; the pane, if enabled, requests current state on load and then follows focus changes. A labeled banner ("Loaded from conversation context (experimental)") appears when the pane auto-fills, with a **Clear, use manual search** button that always works.
4. If anything looks wrong — wrong conversation loaded, stale banner, or an error state in the pane — the safe response is to press **Clear, use manual search** and/or turn `enableContextBridge` back off; the manual search box is unaffected either way.

**Rollback / disable, fastest to most complete:**

| Action | Effect |
|---|---|
| Press **Clear, use manual search** in the pane | Reverts that one session's analyzer to manual input immediately |
| Set `enableContextBridge` back to **No** on the pane tool configuration | Pane stops listening for bridge messages entirely; no code changes needed |
| Remove the `OnLoad`/`OnSave`/`OnUnload` bindings to `pwr_conversationcontext_bridge` from the form | Form stops publishing; harmless if the pane is still listening (it will just show nothing and fall back to manual, same as today's baseline) |
| Remove the `pwr_conversationcontext_bridge` web resource | Full removal; do this last, after unwiring the form events |

None of these touch Dataverse schema, the plugin, or the Custom APIs — the whole feature is client-side and reversible without a solution reimport.

## Surfacing the pages
- **Routing Overview**: create a custom page in your admin/supervisor app, drop the `RoutingOverview` control on it full-page. Add the page to the CSW site map for supervisors.
- **Conversation Analyzer page**: same, with the `ConversationAnalyzer` control. Name the page `pwr_conversationanalyzer_page` — the overview's "Open in Conversation Analyzer" deep link targets that name and passes `pwr_id` in the query string.
- **Supported `recordId`/`entityName` binding**: on the Conversation Analyzer custom page, also set the control's `conversationId` input to the Power Fx expression `Param("recordId")`. This is what `openConversationAnalyzerPage` (used by both the `RoutingOverview` button and `pwr_conversationanalyzer_launch.js`) relies on — it calls `Xrm.Navigation.navigateTo` with `pageInput.recordId`/`pageInput.entityName`, which the page reads back via `Param()`. This is distinct from, and unaffected by, the fact that custom pages reject arbitrary query-string parameters — see [README Known limits](../README.md#known-limits).
- **Conversation Analyzer page name environment variable**: set `pwr_ConversationAnalyzerPageName` to the page's logical name (visible in the maker portal after the random-suffix rename) so `openConversationAnalyzerPage` can build the navigation call. Needed for both the `RoutingOverview` deep-link button and the new `pwr_conversationanalyzer_launch.js` command-bar button described above.
- **Settings**: add the `pwr_settings.html` web resource to the admin app site map.

Two things to know when authoring the pages:

- **Power Apps component framework for canvas apps** must be On for the environment (admin center → Settings → Product → Features). Custom pages are canvas-based; without it the Code tab is empty and the controls never appear.
- After publishing a custom page, **republish the model-driven app** that hosts it. Every time. Otherwise users keep the previous version.

After authoring the custom pages once in a dev environment, add them to the `ConversationDiagnostics` solution and export — from then on the pages ship inside the solution and CI packs them automatically.

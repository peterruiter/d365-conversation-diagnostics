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

**On session context:** the pane isn't contextually bound to the session, so the control's search box is the primary, always-available way to load a conversation — paste the id, or the URL from **Copy link**. But since Application Insights telemetry lags behind the live conversation, most real lookups here happen *after* the conversation has closed — often by a supervisor who was never in that session at all. Plan around the record-scoped options below as the default, not the pane. See [Getting a conversation into the analyzer without a manual paste](#getting-a-conversation-into-the-analyzer-without-a-manual-paste).

## Getting a conversation into the analyzer without a manual paste

In order of what to set up first: the two record-scoped routes work for any conversation, open or closed, and cost nothing to enable. Pane auto-fill is a nice-to-have on top, for a conversation that's still ongoing. Full design rationale and security notes are in [docs/architecture.md](architecture.md#pane-auto-fill-for-live-conversations).

### Recommended: bind or launch the analyzer from the Conversation

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

Both options avoid the pane tool entirely, and because they read the record itself rather than session state, both work exactly the same whether the conversation is still open or closed and reviewed a week later — which is the common case here.

### Automatic: pane auto-fill for a live conversation

**No setup needed — it's built into the control.** There's nothing to turn on here: the Pane tool configuration screen (the screenshot in step 2 above) has no field for a custom control's input properties at all, so this can't be a toggle the way it might be on a form. Instead, whenever the pane control finds no bound/URL id — which in the pane is always, since there's nothing to bind it to — it calls Microsoft's documented `Microsoft.Omnichannel.getConversationId()` directly. Read [docs/architecture.md#pane-auto-fill-for-live-conversations](architecture.md#pane-auto-fill-for-live-conversations) for what it can and can't do — in short, it only ever fills in a conversation that's still ongoing; it does nothing once the conversation closes (rechecking once a second until it does), which is why it's a convenience on top of the routes above, not a replacement for them.

Open a live conversation session and the search box fills in on its own within a second or two. Switching to a different live session re-checks automatically. If anything looks wrong, just type or paste over it — the search box is always live and always wins the moment you touch it, no extra step needed.

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

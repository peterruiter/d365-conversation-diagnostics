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

**On session context:** Microsoft documents that custom productivity tools are not contextually bound to the session and have no supported mechanism to read session context. The control tries to pull the live work item id from the focused session and falls back to its search box when that fails — plan on pasting the id. For automatic context, use the full analyzer page and pass `pwr_id` on the URL instead.

## Surfacing the pages
- **Routing Overview**: create a custom page in your admin/supervisor app, drop the `RoutingOverview` control on it full-page. Add the page to the CSW site map for supervisors.
- **Conversation Analyzer page**: same, with the `ConversationAnalyzer` control. Name the page `pwr_conversationanalyzer_page` — the overview's "Open in Conversation Analyzer" deep link targets that name and passes `pwr_id` in the query string.
- **Settings**: add the `pwr_settings.html` web resource to the admin app site map.

Two things to know when authoring the pages:

- **Power Apps component framework for canvas apps** must be On for the environment (admin center → Settings → Product → Features). Custom pages are canvas-based; without it the Code tab is empty and the controls never appear.
- After publishing a custom page, **republish the model-driven app** that hosts it. Every time. Otherwise users keep the previous version.

After authoring the custom pages once in a dev environment, add them to the `ConversationDiagnostics` solution and export — from then on the pages ship inside the solution and CI packs them automatically.

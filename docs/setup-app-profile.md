# Add the Conversation Analyzer to the productivity pane

Same mechanics as any productivity tool (Presence Hub users will recognize this).

1. Power Apps maker portal → your environment → open the **App profile manager** (or Copilot Service admin center → Workspaces → Agent experience profiles).
2. Pick the profile your supervisors/agents use (or clone the default).
3. **Productivity pane** → turn the pane on → **Add tool**.
4. Select the **Conversation Analyzer** control (namespace `ConversationDiagnostics`), give it a label and the timer icon from `img/`.
5. Save and assign the profile to the right users.
6. Open Customer Service workspace, start or open a conversation session: the tool resolves the conversation id from the focused session automatically. On a case session, paste the related conversation id manually (automatic case → conversation resolution is on the roadmap).

## Surfacing the pages
- **Routing Overview**: create a custom page in your admin/supervisor app, drop the `RoutingOverview` control on it full-page. Add the page to the CSW site map for supervisors.
- **Conversation Analyzer page**: same, with the `ConversationAnalyzer` control. Name the page `crd_conversationanalyzer_page` — the overview's "Open in Conversation Analyzer" deep link targets that name and passes `crd_id` in the query string.
- **Settings**: add the `crd_settings.html` web resource to the admin app site map.

After authoring the custom pages once in a dev environment, add them to the `ConversationDiagnostics` solution and export — from then on the pages ship inside the solution and CI packs them automatically.

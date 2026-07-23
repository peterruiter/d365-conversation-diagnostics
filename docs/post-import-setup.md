# Post-import setup

You imported the solution. It contains the two PCF controls and five environment variable definitions — nothing else. The plugin, the Custom APIs, the settings page and the two custom pages are all still to come. Work through these steps in order; several depend on the one before.

Budget 60–90 minutes for a first run.

## Installing from a release?

The release solution carries the plugin assembly and the three Custom APIs, so **steps 4 and 5 are already done for you**. Each has a check at the top — run it, confirm, move on. Everything else applies unchanged.

## What the solution gave you

| In the solution | You add it below |
|---|---|
| Both PCF controls | Settings web resource (step 6) |
| 5 environment variable definitions | 2 custom pages (step 8) |
| Plug-in assembly `ConversationDiagnosticsPlugins` | Site map entries (step 9) |
| 3 Custom APIs (`pwr_*`) | Productivity pane tool (step 10) |

The right-hand column is what Microsoft's platform will not let a solution carry cleanly, or what would overwrite your own apps if it did.

**Verify first.** Open the solution in the maker portal and confirm you see:

- Both code components
- All five environment variables (`pwr_TenantId`, `pwr_ClientId`, `pwr_AppInsightsAppId`, `pwr_ClientSecret`, `pwr_ClientSecretPlain`)
- The plug-in assembly and three Custom APIs

Anything missing changes which steps below you need. Steps 4 and 5 each open with a check for exactly this reason.

---

## 1. Enable code components for canvas apps

Custom pages are canvas-based. Without this setting the PCF controls will not appear when you build the pages in step 8, and the failure mode is silent — the Code tab is just empty.

1. Go to the [Power Platform admin center](https://admin.powerplatform.microsoft.com).
2. Environments → your environment → **Settings**.
3. Under **Product**, select **Features**.
4. Turn **Power Apps component framework for canvas apps** to **On**.
5. **Save** (bottom right).

Needs System Administrator. It is on by default for model-driven apps but off for canvas — and custom pages count as canvas.

## 2. Confirm telemetry is flowing

The dashboards read Dynamics conversation diagnostics from Application Insights. If the export is not configured, everything below installs cleanly and then shows empty grids.

1. In Copilot Service admin center, confirm conversation diagnostics export to Application Insights is on. This needs a managed environment.
2. In the Application Insights resource, run this in **Logs** and confirm you get rows:

   ```kusto
   traces
   | where customDimensions["powerplatform.analytics.scenario"] == "ConversationDiagnosticsScenario"
   | take 10
   ```

Nothing back? Stop here and fix the export first. Everything downstream depends on it.

## 3. Azure app registration

Full detail in [setup-azure.md](setup-azure.md). Summary:

1. Entra ID → App registrations → New registration. Name it something like `D365 Conversation Diagnostics Reader`. No redirect URI.
2. Certificates & secrets → New client secret. **Copy the value now** — it is shown once.
3. Open the Application Insights resource → Access control (IAM) → Add role assignment → **Reader** → select the app registration.
4. Application Insights → **API Access** → copy the **Application ID**.

Keep four values to hand: tenant id, client id, client secret, App ID.

> The App ID is not the instrumentation key and not the Azure resource id. Wrong value here produces a 404 from the query API, which reads like a permissions problem but is not.

## 4. Register the plugin assembly — check first

**If you installed a release, this step is already done.** The plugin assembly ships inside the solution, so importing it registers the assembly for you. Same if you build from source and your `solution/src` contains a `PluginAssemblies` folder.

Confirm before you do anything. Paste this in a browser tab while signed in:

```
https://<yourorg>.crm4.dynamics.com/api/data/v9.2/pluginassemblies?$select=name,version&$filter=name eq 'ConversationDiagnosticsPlugins'
```

A row back means you are done here — **skip to step 5**. Registering it again through PRT creates a second assembly and the Custom APIs bind to the wrong one.

Nothing back? Register it by hand:

1. Get the assembly. From a release: the `ConversationDiagnosticsPlugins.dll` from the Releases page. From source: run `.\build.ps1`, which writes it to `src/plugin/ConversationDiagnostics.Plugins/bin/Release/net462/`.
2. Authenticate: `pac auth create --environment https://yourorg.crm4.dynamics.com`
3. Launch the Plugin Registration Tool: `.\deploy\push-plugin.ps1 -Register`
4. In PRT:
   - **Create connection** → sign in
   - **Register → Register New Assembly**
   - Browse to the dll above
   - Isolation Mode **Sandbox**, Location **Database**
   - **Register Selected Plugins**

Register the assembly only. Do **not** add any steps — the plugin types are invoked by Custom APIs, not by SDK message steps.

The assembly registers under the name **`ConversationDiagnosticsPlugins`** — no dots. The dll filename is deliberately dot-free because the solution packager mangles dotted assembly names. The C# namespaces are still `ConversationDiagnostics.Plugins.*`, so the plugin type names are unaffected. Step 5 looks the assembly up by that name.

> `pac plugin push` cannot do a first registration. Its `--pluginId` parameter is required and that GUID only exists after the assembly is registered. Use it for later updates: `.\deploy\push-plugin.ps1 -Update -PluginId <guid>`.

## 5. Create the Custom APIs — check first

**If you installed a release, this is already done too.** The three Custom APIs ship in the solution alongside the assembly.

Check:

```
https://<yourorg>.crm4.dynamics.com/api/data/v9.2/customapis?$select=uniquename&$filter=startswith(uniquename,'pwr_')
```

Three rows back means skip to step 6:

| Custom API | Purpose |
|---|---|
| `pwr_ExecuteDiagnosticsQuery` | Runs a named query from the server-side KQL library |
| `pwr_GetConversationDiagnostics` | Returns the full event stream for one conversation |
| `pwr_TestDiagnosticsConnection` | Powers the Test connection button |

Missing or incomplete? Create them:

```powershell
.\deploy\register-customapis.ps1 -EnvironmentUrl https://yourorg.crm4.dynamics.com
```

The script is idempotent: it skips APIs that already exist and tells you so. Safe to run even if you are unsure.

**Dependency:** it authenticates with the Azure CLI (`az account get-access-token`). Install Azure CLI first, or swap the token acquisition for your preferred method. The script prompts an `az login` if no token is cached.

Verify: in the maker portal the three APIs should appear under Custom APIs, each with a Plugin Type set and their request/response parameters listed.

If it reports the assembly was not found, it lists the similarly named assemblies that *are* registered. Pass the right one explicitly:

```powershell
.\deploy\register-customapis.ps1 -EnvironmentUrl https://yourorg.crm4.dynamics.com -PluginAssemblyName ConversationDiagnosticsPlugins
```

> **Parameter types are immutable.** If the APIs exist but the dashboards fail, the parameters may have been created with the wrong type. Recreate them with `-Force`.

## 6. Add the settings page

The web resource ships as a loose file in the repo, not inside the solution. Add it once, then step 13 captures it permanently.

1. Maker portal → Solutions → your solution → **New → More → Web resource**.
2. Display name: `Conversation Diagnostics Settings`. Name: `pwr_settings.html`. Type: **HTML**.
3. Upload `src/webresources/pwr_settings.html`.
4. Save, then **Publish**.

## 7. Configure and test the connection

Open the web resource (from the solution, select it and use **Preview**, or reach it via the site map after step 9) and fill in:

| Field | Value from step 3 |
|---|---|
| Entra tenant id | Directory (tenant) ID |
| App registration client id | Application (client) ID |
| Application Insights App ID | App ID from API Access |
| Client secret (fallback) | leave empty if using Key Vault — see below |

**Secret handling.** Preferred is the Key Vault-backed secret variable `pwr_ClientSecret`:

1. Store the client secret in Azure Key Vault.
2. Grant the Dataverse service principal `Key Vault Secrets User` on the vault.
3. In the maker portal, open the `pwr_ClientSecret` environment variable and set the Key Vault reference (subscription id, resource group, vault name, secret name).

The plain `pwr_ClientSecretPlain` variable is the fallback. Its value sits in Dataverse readable by admins — dev and demo only.

Now press **Test connection**. It runs `traces | take 1` end to end and reports the specific failure if something is off. Do not continue until this returns OK.

| Message | Cause |
|---|---|
| Could not authenticate to Azure | tenant id, client id or secret wrong |
| Query failed (403) | app registration missing Reader on the resource |
| Query failed (404) | wrong App ID — you likely used the instrumentation key or resource id |
| environment variable … is not set | variable missing or value not saved |

## 8. Build the two custom pages

Custom pages cannot be authored as code, so this is manual once. After step 13 they ship in the solution.

**Routing Overview page**

1. Solutions → your solution → **New → App → Page** (custom page).
2. Insert → **Get more components** → **Code** tab → import **RoutingOverview**.
3. Drag it onto the page, set width and height to fill the screen.
4. Save. Name it `Routing Overview`. Publish.

**Conversation Analyzer page**

Same steps with the **ConversationAnalyzer** control. Name it whatever reads well — `Conversation Analyzer` is fine.

This page is optional. The Routing Overview explains routing inline via its **Explain this routing** button, so you only need a standalone analyzer page if you want a full-screen view or a site map entry for it.

## 9. Surface the pages in your apps

You chose your own admin experience plus Customer Service workspace, so nothing here touches Microsoft's admin app.

**For supervisors — Customer Service workspace**

1. Open the CSW app in the app designer.
2. Add both custom pages to the site map, under a group such as `Diagnostics`.
3. Save and **Publish**.

**For admins — your admin app**

1. Add the Routing Overview page and the `pwr_settings.html` web resource to the site map.
2. Save and Publish.

> Every time you edit and publish a custom page, you must also republish the model-driven app that hosts it. Skip that and users keep seeing the old version.

## 10. Add the analyzer to the productivity pane

Two stages, and the order matters: you register the control as a **custom productivity tool** first, then enable that tool on an experience profile. The tool will not appear in the profile until it exists.

### 10a. Security roles

- The admin doing this configuration needs **Productivity tools administrator**.
- Every supervisor and representative who should see the tool needs **Productivity tools user**.

Assign these before you start, or the Productivity area is missing or read-only.

### 10b. Register the custom productivity tool

1. Copilot Service admin center → site map → **Productivity** (under **Support experience**).
2. Select **Manage** for **Productivity tools**.
3. **New**, and fill in **New Pane tool configuration**:

| Field | Value |
|---|---|
| Name | `Conversation Analyzer` |
| Unique Name | `pwr_conversationanalyzer` |
| Type | **Control** |
| Control Name | `pwr_ConversationDiagnostics.ConversationAnalyzer` |
| Icon | optional — a web resource icon |
| Global | **No** — see the scoping note below. `Yes` shows the tool everywhere, including the home session |
| Description | optional |
| Learn More Link | optional |

4. **Save.**

> **Type = Control** hosts the PCF directly, which is what this solution ships. Choosing **Custom Page** instead hosts the analyzer page from step 8 — that also works, and is the better fallback if the control route gives you trouble.

**Control Name must match the manifest exactly**, case included:

| Control | Control Name value |
|---|---|
| Conversation Analyzer | `pwr_ConversationDiagnostics.ConversationAnalyzer` |
| Routing Overview | `pwr_ConversationDiagnostics.RoutingOverview` |

**The publisher prefix is part of the name.** The solution packager prepends your publisher's customization prefix to the manifest namespace, so the manifest says `ConversationDiagnostics.ConversationAnalyzer` but the environment registers `pwr_ConversationDiagnostics.ConversationAnalyzer`. Fork this repo with a different publisher and your prefix replaces `pwr_`.

Always confirm against your own environment before typing it — paste this in a browser tab while signed in:

```
https://<yourorg>.crm4.dynamics.com/api/data/v9.2/customcontrols?$select=name&$filter=contains(name,'ConversationDiagnostics')
```

Whatever `name` comes back is the string to use, verbatim. A mismatch produces `UciError: No manifest found` when the pane loads.

### Scoping: the tool shows everywhere

There is no entity-level scoping for custom productivity tools. The `msdyn_panetoolconfiguration` table has no field to bind a tool to conversations, cases, or any other table — the only lever is **Global**:

| Global | Behaviour |
|---|---|
| Yes | Visible everywhere, including the home session |
| No | Visible within sessions, not on the home session |

Set **Global = No** to get closest to "conversations only". It will still appear on every session type, including case sessions. Microsoft's own contextual tools (Smart Assist and friends) are product features with privileged context access; custom tools do not get the same treatment, which is consistent with the session-context limitation in 10d.

If you need it hidden outside conversations, that has to be handled inside the control — render an empty state when no conversation is in context rather than trying to hide the icon.

### 10c. Enable it on the experience profile

1. Site map → **Workspaces** (under **Support experiences**) → **Manage** for **Experience profiles**.
2. Select the profile your supervisors use. Clone the default rather than editing it.
3. Select **Edit** for **Productivity pane**.
4. Enable **Conversation Analyzer**, and save.
5. Confirm the profile is assigned to the right users.

### 10d. Expect to paste the id

Microsoft documents that custom productivity tools **are not contextually bound to the session and have no supported mechanism to read session context**. So the analyzer cannot reliably auto-detect which conversation the representative is looking at.

The control makes a best-effort attempt to read the live work item id from the focused session, and falls back to its search box when that returns nothing — which, per the documentation above, is the case you should plan for. Paste the conversation id from the record you are viewing.

If auto-resolution matters more than pane placement, use the full **Conversation Analyzer** page from step 8 instead: opened from a record, you can pass the id on the URL as `pwr_id`, which the control reads directly.

## 11. Lock down who can query

As registered, any user who can reach the pages can call the Custom APIs, and the plugin queries Azure as SYSTEM. That is the point — users need no Azure access — but it also means the API is the access boundary.

To restrict it:

1. Create a privilege or pick an existing one that only supervisors hold.
2. Set `executeprivilegename` on each Custom API to that privilege.
3. Confirm your supervisor role has read access to the environment variable tables.

Decide this before you roll out beyond a pilot group.

## 12. End-to-end verification

1. Open **Routing Overview** in CSW. Incoming work items load for the last 6 hours.
2. Click a row. The classification, route-to-queue, assignment and timeline panels fill.
3. Click **Open in Conversation Analyzer**. The analyzer opens on that work item with the timeline, metrics and the written explanation.
4. Open a conversation in CSW and check the analyzer in the productivity pane resolves the session automatically.
5. Change the time range on the overview and confirm the problem spotlight sections load when expanded.

Empty grids with no error mean telemetry, not configuration — go back to step 2.

## 13. Capture the manual work into the solution

Anything you created by hand lives only in your environment until you capture it. The released solution has to carry it, or every person who installs this repeats your work.

If you installed a release, the plugin assembly and Custom APIs are already captured — this step is about the settings page and the custom pages you built in steps 6 and 8.

**Add these to the solution** (maker portal → your solution → Add existing):

| Component | Where to find it |
|---|---|
| Plug-in assembly `ConversationDiagnosticsPlugins` | Add existing → More → Plug-in assembly (skip if it came with the solution) |
| The 3 Custom APIs | Add existing → More → Custom API (skip if they came with the solution) |
| Web resource `pwr_settings.html` | Already added in step 6 if you created it inside the solution |
| Both custom pages | Add existing → App → Page |

**Do not add the Customer Service workspace app or its site map.** That app is Microsoft's, and putting it in your solution makes your solution depend on the Dynamics 365 Customer Service solutions it ships in — which is what produces missing-dependency warnings on export. It also means your solution would overwrite site map customisations on anyone else's tenant. Installers add the pages to their own apps instead; that is step 9 and it stays a manual step by design.

Then capture it into source control:

```powershell
.\deploy\capture-solution.ps1
```

That exports the unmanaged solution, unpacks it over `solution/src`, and checks the result for environment-specific values before you commit.

> **Do not commit environment variable values.** Definitions belong in source control; values carry your tenant id, client id, App Insights App ID and, if you used the plain fallback, a client secret. `capture-solution.ps1` flags both `environmentvariablevalue` records and any `<defaultvalue>` left in a definition. Clear them before committing.

Commit the result. The unpack writes the plugin assembly into `solution/src/PluginAssemblies/…`, the Custom APIs into `solution/src/CustomAPIs/…`, and the pages into `solution/src/CanvasApps/…`. From that point a fresh environment is a single import — steps 4, 5, 6 and 8 disappear, leaving only 1, 2, 3, 7 and 10.

> **Check your build matches your release.** If you added the plugin and Custom APIs through the maker portal and exported that zip for the release, but never unpacked it over `solution/src`, then `build.ps1` produces a *smaller* solution than the one you published. Unpack and commit so both paths produce the same artifact.

### Dependency warnings on export

Exporting may warn about a dependency on a Microsoft solution. Microsoft's guidance is that these warnings **can be ignored when the solution is designed to be installed over a pre-installed base solution** — which is exactly this case, since Customer Service with unified routing is a prerequisite. The dependency only breaks an import if the target environment genuinely lacks the component.

Before ignoring it, check what is actually pulling it in:

1. Solutions → your solution → **Show dependencies**, or select a component → **Show dependencies**.
2. Work through the list and ask, for each: does this belong in a redistributable solution?

Usual culprits and what to do:

| Pulled in by | Action |
|---|---|
| Customer Service workspace app or its site map | Remove from the solution. Installers wire up their own apps in step 9 |
| Productivity tool configuration record | Fine to leave — the table ships with Customer Service, which is a prerequisite anyway |
| Custom pages | Fine — pages legitimately depend on platform components |

Keep the solution to components you actually authored. Everything that customises Microsoft's own apps stays a documented manual step.

> **The binary in source control gets stale.** After unpacking, `solution/src/PluginAssemblies/…/ConversationDiagnosticsPlugins.dll` is a snapshot. Rebuild the plugin and that file is out of date until you copy the fresh one over it. Add that copy step to `build.ps1` before packing, or re-export after every plugin change.

---

## Troubleshooting

### "An unexpected error occurred from ISV code"

Dataverse shows this when a plugin throws anything other than an `InvalidPluginExecutionException`. The message is deliberately opaque — you need the plugin trace log to see the real cause.

**Turn on plugin tracing first:**

1. Advanced settings → Administration → **System Settings** → **Customization** tab.
2. **Enable logging to plug-in trace log** → **All**.
3. Reproduce the error.
4. Advanced settings → **Plug-in Trace Log** → open the newest record → read **Message Block** and **Exception Details**.

The plugins log the query key, parameters and the full KQL they built, so the trace shows exactly what ran.

**Known cause — wrong Custom API parameter type.** Releases before this fix registered `TimeRangeHours` with type `6`, which is **Float**, not Integer (`7`). Dataverse then hands the plugin a `double`, the cast to `int` fails, and you get the ISV-code error on both dashboards while **Test connection keeps working** — that API is the only one with no input parameters.

Repair it. Custom API parameter types are immutable after creation, so the APIs must be deleted and recreated:

```powershell
.\deploy\register-customapis.ps1 -EnvironmentUrl https://yourorg.crm4.dynamics.com -Force
```

Rebuild and update the plugin too, so parameters are read tolerantly and any future failure reports its real cause:

```powershell
.\build.ps1
.\deploy\push-plugin.ps1 -Update -PluginId <assembly-guid>
```

### "No manifest found" (UciError) in the productivity pane

The **Control Name** on the pane tool configuration does not match a registered control. Look up the real value:

```
https://<yourorg>.crm4.dynamics.com/api/data/v9.2/customcontrols?$select=name&$filter=contains(name,'ConversationDiagnostics')
```

Expect `pwr_ConversationDiagnostics.ConversationAnalyzer`. The most common miss is **dropping the publisher prefix** — the manifest namespace is `ConversationDiagnostics`, but the registered control carries your publisher prefix in front of it. Also check for wrong case, or the Unique Name having been pasted into the Control Name field.

If the query returns nothing, the solution's code components did not import — reimport before going further.

Still failing with the right name? Switch the tool **Type** to **Custom Page** and point it at the analyzer page from step 8. That route avoids control resolution entirely.

### Custom page errors when you add a parameter to its URL

Custom pages reject arbitrary query string parameters. `?pagetype=custom&name=<page>` works; adding `&pwr_id=<guid>` produces a generic "An error has occurred". This is why the Routing Overview explains routing inline instead of deep linking.

### Build fails with "Solution package type did not match requested type"

```
Command line argument: Both
Package type: Unmanaged
```

The unpacked source under `solution/src` was written by `pac solution unpack --packagetype Unmanaged`, but the cdsproj builds `Both`. The source has to carry managed metadata as well.

Re-run the capture, which exports both flavours and unpacks with `--packagetype Both`:

```powershell
.\deploy\capture-solution.ps1
```

### Rebuilt and reimported, but nothing changed

Almost always the control version. **Dataverse only refreshes a code component when its version number changes.** Reimport the same version and the platform keeps the resources it already has, so your new code never runs.

```powershell
.\build.ps1 -BumpControls -Import    # bump versions, build, import and publish
```

`-Import` calls `deploy/import-solution.ps1`, which imports with `--publish-changes` so the publish step is handled for you. Then:

1. **Hard refresh** the browser (Ctrl+F5). Code components cache aggressively.
2. Republish any model-driven app hosting a changed custom page.

Importing by hand instead? **Publish all customizations** afterwards — the script does this for you, the maker portal does not.

You do **not** need to rebuild the custom pages. A page references a control by name, it does not embed a copy, so a version bump plus publish is enough.

**The settings page is a separate case.** Web resources are not compiled by the PCF build. Until the release that added `solution/src/WebResources/`, the settings page had to be re-uploaded by hand after every change — Solutions → your solution → the web resource → **Upload file** → pick `src/webresources/pwr_settings.html` → Save → **Publish**.

### Both dashboards load but grids are empty

Configuration is fine; telemetry is not reaching Application Insights. Go back to step 2.

---

## What needs publishing

Publishing is not uniform across component types, which is a common source of "I changed it but nothing happened".

| Component | Publish needed? |
|---|---|
| Plug-in assembly | No — active as soon as PRT registers it |
| Custom APIs | No — available immediately after creation |
| Environment variables | No — values are read at runtime |
| Web resources | **Yes** — publish the web resource |
| Custom pages | **Yes** — publish the page, **then republish every model-driven app that hosts it** |
| Site map changes | **Yes** — publish the app |
| PCF controls | Published by the solution import |

When in doubt, **Publish all customizations** on the solution. It is slower but never wrong.

---

## Order of dependencies

```
1. PCF for canvas ─────────────────────────────┐
2. Telemetry flowing ──┐                       │
3. Azure app reg ──────┤                       │
                       ▼                       ▼
4. Register plugin ─▶ 5. Custom APIs ─▶ 7. Configure + test
                                               │
                       6. Settings page ───────┘
                                               ▼
                                    8. Custom pages ─▶ 9. Site map ─▶ 10. Productivity pane
                                                                            ▼
                                                              11. Security ─▶ 12. Verify ─▶ 13. Capture
```

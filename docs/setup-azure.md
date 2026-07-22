# Azure setup

One app registration does all querying. Users never get Azure access.

## 1. App registration
1. Entra ID → App registrations → **New registration**. Name: `D365 Conversation Diagnostics Reader`.
2. No redirect URI needed (client credentials only).
3. Certificates & secrets → **New client secret**. Copy the value.

## 2. Grant read access to telemetry
1. Open the Application Insights resource that receives the Dynamics conversation diagnostics export.
2. Access control (IAM) → Add role assignment → **Reader** → select the app registration.
3. Go to **API Access** and copy the **Application ID**. That is the value the solution needs — not the instrumentation key, not the Azure resource id.

> The solution queries the Application Insights API only. The FastTrack KQL uses Application Insights schema (`traces`, `timestamp`, `customDimensions`). Querying the Log Analytics workspace API directly is not supported, because that surface uses different table and column names (`AppTraces`, `TimeGenerated`, `Properties`). If your telemetry is workspace-based, that is fine — the Application Insights API reads the same data.

## 3. Secret storage (pick one)
**Preferred — Key Vault-backed secret environment variable**
1. Store the client secret in Azure Key Vault.
2. Grant the Dataverse service principal (`Microsoft.PowerPlatform` / Dataverse) `Get` on secrets, or use RBAC `Key Vault Secrets User`.
3. In your environment, set the secret environment variable `pwr_ClientSecret` to the Key Vault reference (subscription id, resource group, vault name, secret name).

**Fallback — plain environment variable**
Set `pwr_ClientSecretPlain` on the settings page. The value sits in Dataverse and is readable by admins. Use only for demos and dev.

## 4. Fill the settings page
Open **Diagnostics Settings** in the admin app and enter tenant id, client id and the Application Insights App ID. Use **Test connection** — it runs `traces | take 1` end to end and reports the exact failure if something is off.

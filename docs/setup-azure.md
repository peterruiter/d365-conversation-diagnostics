# Azure setup

One app registration does all querying. Users never get Azure access.

## 1. App registration
1. Entra ID → App registrations → **New registration**. Name: `D365 Conversation Diagnostics Reader`.
2. No redirect URI needed (client credentials only).
3. Certificates & secrets → **New client secret**. Copy the value.

## 2. Grant read access to telemetry
Pick the one that matches your setup:

**Application Insights (classic query API, recommended)**
1. Open the App Insights resource that receives the Dynamics conversation diagnostics export.
2. Access control (IAM) → Add role assignment → **Reader** → select the app registration.
3. Note the **App ID** under API Access (not the resource id, not the instrumentation key).

**Log Analytics workspace**
1. Open the workspace behind your workspace-based App Insights resource.
2. IAM → Add role assignment → **Log Analytics Reader** → select the app registration.
3. Note the **Workspace ID** from the overview page.

## 3. Secret storage (pick one)
**Preferred — Key Vault-backed secret environment variable**
1. Store the client secret in Azure Key Vault.
2. Grant the Dataverse service principal (`Microsoft.PowerPlatform` / Dataverse) `Get` on secrets, or use RBAC `Key Vault Secrets User`.
3. In your environment, set the secret environment variable `crd_ClientSecret` to the Key Vault reference (subscription id, resource group, vault name, secret name).

**Fallback — plain environment variable**
Set `crd_ClientSecretPlain` on the settings page. The value sits in Dataverse and is readable by admins. Use only for demos and dev.

## 4. Fill the settings page
Open **Diagnostics Settings** in the admin app and enter tenant id, client id, target type, and the App ID or Workspace ID. Use **Test connection** — it runs `traces | take 1` end to end and reports the exact failure if something is off.

using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace ConversationDiagnostics.Plugins.Core
{
    /// <summary>
    /// Connection settings for the Application Insights query API.
    /// The queries in <see cref="QueryLibrary"/> are written in Application Insights
    /// schema (traces / timestamp / customDimensions), so Application Insights is the
    /// only supported query surface. Querying the Log Analytics workspace API directly
    /// would need a parallel query set in workspace schema (AppTraces / TimeGenerated / Properties).
    /// </summary>
    public sealed class DiagnosticsConfig
    {
        public string TenantId { get; set; }
        public string ClientId { get; set; }
        public string ClientSecret { get; set; }
        /// <summary>Application Insights App ID, from the resource's API Access blade.</summary>
        public string AppId { get; set; }

        public void Validate()
        {
            if (string.IsNullOrWhiteSpace(TenantId)) throw new InvalidPluginExecutionException("Conversation Diagnostics: environment variable pwr_TenantId is not set. Configure it in the Diagnostics Settings page.");
            if (string.IsNullOrWhiteSpace(ClientId)) throw new InvalidPluginExecutionException("Conversation Diagnostics: environment variable pwr_ClientId is not set.");
            if (string.IsNullOrWhiteSpace(ClientSecret)) throw new InvalidPluginExecutionException("Conversation Diagnostics: no client secret found. Set the Key Vault-backed secret variable pwr_ClientSecret, or the fallback pwr_ClientSecretPlain.");
            if (string.IsNullOrWhiteSpace(AppId)) throw new InvalidPluginExecutionException("Conversation Diagnostics: environment variable pwr_AppInsightsAppId is not set. Use the Application Insights App ID from the resource's API Access blade (not the instrumentation key or the Azure resource id).");
        }
    }

    public static class ConfigReader
    {
        public static DiagnosticsConfig Read(IOrganizationService service)
        {
            var cfg = new DiagnosticsConfig
            {
                TenantId = GetEnvVar(service, "pwr_TenantId"),
                ClientId = GetEnvVar(service, "pwr_ClientId"),
                AppId = GetEnvVar(service, "pwr_AppInsightsAppId")
            };

            // Preferred: Key Vault-backed secret environment variable.
            cfg.ClientSecret = GetSecretEnvVar(service, "pwr_ClientSecret");
            // Fallback: plain string environment variable (discouraged, documented as such).
            if (string.IsNullOrWhiteSpace(cfg.ClientSecret))
                cfg.ClientSecret = GetEnvVar(service, "pwr_ClientSecretPlain");

            cfg.Validate();
            return cfg;
        }

        private static string GetEnvVar(IOrganizationService service, string schemaName)
        {
            var query = new QueryExpression("environmentvariabledefinition")
            {
                ColumnSet = new ColumnSet("defaultvalue"),
                Criteria = { Conditions = { new ConditionExpression("schemaname", ConditionOperator.Equal, schemaName) } }
            };
            var valueLink = query.AddLink("environmentvariablevalue", "environmentvariabledefinitionid", "environmentvariabledefinitionid", JoinOperator.LeftOuter);
            valueLink.Columns = new ColumnSet("value");
            valueLink.EntityAlias = "v";

            var result = service.RetrieveMultiple(query);
            if (result.Entities.Count == 0) return null;

            var e = result.Entities[0];
            var current = e.GetAttributeValue<AliasedValue>("v.value")?.Value as string;
            return !string.IsNullOrWhiteSpace(current) ? current : e.GetAttributeValue<string>("defaultvalue");
        }

        private static string GetSecretEnvVar(IOrganizationService service, string schemaName)
        {
            try
            {
                var req = new OrganizationRequest("RetrieveEnvironmentVariableSecretValue");
                req["EnvironmentVariableName"] = schemaName;
                var resp = service.Execute(req);
                return resp.Results.Contains("EnvironmentVariableSecretValue")
                    ? resp["EnvironmentVariableSecretValue"] as string
                    : null;
            }
            catch
            {
                // Variable not defined or Key Vault not reachable; caller falls back.
                return null;
            }
        }
    }
}

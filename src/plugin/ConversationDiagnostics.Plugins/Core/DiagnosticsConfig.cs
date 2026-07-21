using System;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

namespace ConversationDiagnostics.Plugins.Core
{
    public enum TargetType { AppInsights, LogAnalytics }

    public sealed class DiagnosticsConfig
    {
        public string TenantId { get; set; }
        public string ClientId { get; set; }
        public string ClientSecret { get; set; }
        public TargetType Target { get; set; }
        /// <summary>Application Insights App ID (Target = AppInsights) or Log Analytics Workspace ID (Target = LogAnalytics).</summary>
        public string ResourceId { get; set; }

        public void Validate()
        {
            if (string.IsNullOrWhiteSpace(TenantId)) throw new InvalidPluginExecutionException("Conversation Diagnostics: environment variable crd_TenantId is not set. Configure it in the Diagnostics Settings page.");
            if (string.IsNullOrWhiteSpace(ClientId)) throw new InvalidPluginExecutionException("Conversation Diagnostics: environment variable crd_ClientId is not set.");
            if (string.IsNullOrWhiteSpace(ClientSecret)) throw new InvalidPluginExecutionException("Conversation Diagnostics: no client secret found. Set the Key Vault-backed secret variable crd_ClientSecret, or the fallback crd_ClientSecretPlain.");
            if (string.IsNullOrWhiteSpace(ResourceId)) throw new InvalidPluginExecutionException("Conversation Diagnostics: set crd_AppInsightsAppId or crd_WorkspaceId depending on crd_TargetType.");
        }
    }

    public static class ConfigReader
    {
        public static DiagnosticsConfig Read(IOrganizationService service)
        {
            var cfg = new DiagnosticsConfig
            {
                TenantId = GetEnvVar(service, "crd_TenantId"),
                ClientId = GetEnvVar(service, "crd_ClientId")
            };

            var targetType = GetEnvVar(service, "crd_TargetType") ?? "AppInsights";
            cfg.Target = string.Equals(targetType, "LogAnalytics", StringComparison.OrdinalIgnoreCase)
                ? TargetType.LogAnalytics
                : TargetType.AppInsights;

            cfg.ResourceId = cfg.Target == TargetType.AppInsights
                ? GetEnvVar(service, "crd_AppInsightsAppId")
                : GetEnvVar(service, "crd_WorkspaceId");

            // Preferred: Key Vault-backed secret environment variable.
            cfg.ClientSecret = GetSecretEnvVar(service, "crd_ClientSecret");
            // Fallback: plain string environment variable (discouraged, documented as such).
            if (string.IsNullOrWhiteSpace(cfg.ClientSecret))
                cfg.ClientSecret = GetEnvVar(service, "crd_ClientSecretPlain");

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

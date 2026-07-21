using System;
using Microsoft.Xrm.Sdk;
using ConversationDiagnostics.Plugins.Core;

namespace ConversationDiagnostics.Plugins
{
    /// <summary>
    /// Custom API: crd_ExecuteDiagnosticsQuery
    /// Inputs:  QueryKey (string), TimeRangeHours (int, optional, default 6), WorkItemId (string guid, optional)
    /// Output:  ResultJson (string) — raw query API response (tables/rows format)
    /// </summary>
    public sealed class ExecuteDiagnosticsQueryPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            // Run data access as the system: users need no Azure permissions.
            var service = factory.CreateOrganizationService(null);

            var queryKey = context.InputParameters.Contains("QueryKey") ? (string)context.InputParameters["QueryKey"] : null;
            if (string.IsNullOrWhiteSpace(queryKey))
                throw new InvalidPluginExecutionException("QueryKey is required.");

            int hours = context.InputParameters.Contains("TimeRangeHours") ? (int)context.InputParameters["TimeRangeHours"] : 6;
            hours = Math.Max(1, Math.Min(hours, 24 * 31)); // clamp: 1 hour .. 31 days

            Guid? workItemId = null;
            if (context.InputParameters.Contains("WorkItemId") && context.InputParameters["WorkItemId"] is string wi && !string.IsNullOrWhiteSpace(wi))
            {
                if (!Guid.TryParse(wi, out var parsed))
                    throw new InvalidPluginExecutionException("WorkItemId must be a GUID.");
                workItemId = parsed;
            }

            var endUtc = DateTime.UtcNow;
            var startUtc = endUtc.AddHours(-hours);
            var kql = QueryLibrary.Bind(queryKey, startUtc, endUtc, workItemId);

            var config = ConfigReader.Read(service);
            var client = new LogAnalyticsClient(config, trace);
            var result = client.ExecuteQuery(kql, TimeSpan.FromHours(hours));

            context.OutputParameters["ResultJson"] = result;
        }
    }

    /// <summary>
    /// Custom API: crd_GetConversationDiagnostics
    /// Inputs:  ConversationId (string guid), TimeRangeHours (int, optional, default 720)
    /// Output:  EventsJson (string) — ordered raw events for the conversation
    /// The explanation is computed client-side by the deterministic explain engine.
    /// </summary>
    public sealed class GetConversationDiagnosticsPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var service = factory.CreateOrganizationService(null);

            var idRaw = context.InputParameters.Contains("ConversationId") ? (string)context.InputParameters["ConversationId"] : null;
            if (!Guid.TryParse(idRaw, out var conversationId))
                throw new InvalidPluginExecutionException("ConversationId must be a GUID.");

            int hours = context.InputParameters.Contains("TimeRangeHours") ? (int)context.InputParameters["TimeRangeHours"] : 720;
            hours = Math.Max(1, Math.Min(hours, 24 * 90));

            var endUtc = DateTime.UtcNow;
            var startUtc = endUtc.AddHours(-hours);
            var kql = QueryLibrary.Bind("ConversationEvents", startUtc, endUtc, conversationId);

            var config = ConfigReader.Read(service);
            var client = new LogAnalyticsClient(config, trace);
            context.OutputParameters["EventsJson"] = client.ExecuteQuery(kql, TimeSpan.FromHours(hours));
        }
    }

    /// <summary>
    /// Custom API: crd_TestDiagnosticsConnection
    /// Output: Success (bool), Message (string). Used by the settings page "Test connection" button.
    /// </summary>
    public sealed class TestConnectionPlugin : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            var service = factory.CreateOrganizationService(null);

            try
            {
                var config = ConfigReader.Read(service);
                var client = new LogAnalyticsClient(config, trace);
                client.ExecuteQuery("traces | take 1", TimeSpan.FromHours(1));
                context.OutputParameters["Success"] = true;
                context.OutputParameters["Message"] = "Connection OK. Telemetry is reachable.";
            }
            catch (Exception ex)
            {
                context.OutputParameters["Success"] = false;
                context.OutputParameters["Message"] = ex.Message;
            }
        }
    }
}

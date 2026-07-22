using System;
using Microsoft.Xrm.Sdk;
using ConversationDiagnostics.Plugins.Core;

namespace ConversationDiagnostics.Plugins
{
    /// <summary>
    /// Shared helpers. Custom API parameters arrive boxed, and the registered type
    /// determines the CLR type (Integer -> int, Float -> double). Reading them with a
    /// hard cast turns a metadata mistake into "An unexpected error occurred from ISV code",
    /// so read tolerantly and let anything unexpected surface with a real message.
    /// </summary>
    internal static class PluginHelpers
    {
        public static string GetString(IPluginExecutionContext context, string name)
        {
            return context.InputParameters.Contains(name) ? context.InputParameters[name] as string : null;
        }

        public static int GetInt(IPluginExecutionContext context, string name, int fallback)
        {
            if (!context.InputParameters.Contains(name)) return fallback;
            var raw = context.InputParameters[name];
            if (raw == null) return fallback;
            try { return Convert.ToInt32(raw, System.Globalization.CultureInfo.InvariantCulture); }
            catch { return fallback; }
        }

        /// <summary>
        /// Runs the plugin body and converts non-InvalidPluginExecutionException failures
        /// into InvalidPluginExecutionException so the caller sees the real cause instead of
        /// the generic Dataverse ISV-code message. Full detail goes to the plugin trace log.
        /// </summary>
        public static void Run(ITracingService trace, string apiName, Action body)
        {
            try
            {
                trace.Trace("{0}: start", apiName);
                body();
                trace.Trace("{0}: done", apiName);
            }
            catch (InvalidPluginExecutionException)
            {
                throw; // already a clean, user-facing message
            }
            catch (Exception ex)
            {
                trace.Trace("{0} failed: {1}", apiName, ex.ToString());
                throw new InvalidPluginExecutionException(
                    $"{apiName} failed: {ex.GetType().Name}: {ex.Message}. See the plugin trace log for detail.", ex);
            }
        }
    }

    /// <summary>
    /// Custom API: pwr_ExecuteDiagnosticsQuery
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

            PluginHelpers.Run(trace, "pwr_ExecuteDiagnosticsQuery", () =>
            {
                var queryKey = PluginHelpers.GetString(context, "QueryKey");
                if (string.IsNullOrWhiteSpace(queryKey))
                    throw new InvalidPluginExecutionException("QueryKey is required.");

                int hours = PluginHelpers.GetInt(context, "TimeRangeHours", 6);
                hours = Math.Max(1, Math.Min(hours, 24 * 31)); // clamp: 1 hour .. 31 days

                Guid? workItemId = null;
                var wi = PluginHelpers.GetString(context, "WorkItemId");
                if (!string.IsNullOrWhiteSpace(wi))
                {
                    if (!Guid.TryParse(wi, out var parsed))
                        throw new InvalidPluginExecutionException($"WorkItemId must be a GUID. Received: '{wi}'.");
                    workItemId = parsed;
                }

                trace.Trace("QueryKey={0} Hours={1} WorkItemId={2}", queryKey, hours, workItemId);

                var endUtc = DateTime.UtcNow;
                var startUtc = endUtc.AddHours(-hours);

                string kql;
                try { kql = QueryLibrary.Bind(queryKey, startUtc, endUtc, workItemId); }
                catch (ArgumentException ex) { throw new InvalidPluginExecutionException(ex.Message); }

                trace.Trace("KQL:\n{0}", kql);

                var config = ConfigReader.Read(service);
                var client = new AppInsightsClient(config, trace);
                context.OutputParameters["ResultJson"] = client.ExecuteQuery(kql, TimeSpan.FromHours(hours));
            });
        }
    }

    /// <summary>
    /// Custom API: pwr_GetConversationDiagnostics
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

            PluginHelpers.Run(trace, "pwr_GetConversationDiagnostics", () =>
            {
                var idRaw = PluginHelpers.GetString(context, "ConversationId");
                if (!Guid.TryParse(idRaw, out var conversationId))
                    throw new InvalidPluginExecutionException($"ConversationId must be a GUID. Received: '{idRaw}'.");

                int hours = PluginHelpers.GetInt(context, "TimeRangeHours", 720);
                hours = Math.Max(1, Math.Min(hours, 24 * 90));

                trace.Trace("ConversationId={0} Hours={1}", conversationId, hours);

                var endUtc = DateTime.UtcNow;
                var startUtc = endUtc.AddHours(-hours);
                var kql = QueryLibrary.Bind("ConversationEvents", startUtc, endUtc, conversationId);
                trace.Trace("KQL:\n{0}", kql);

                var config = ConfigReader.Read(service);
                var client = new AppInsightsClient(config, trace);
                context.OutputParameters["EventsJson"] = client.ExecuteQuery(kql, TimeSpan.FromHours(hours));
            });
        }
    }

    /// <summary>
    /// Custom API: pwr_TestDiagnosticsConnection
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
                var client = new AppInsightsClient(config, trace);
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

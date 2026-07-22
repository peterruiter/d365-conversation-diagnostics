using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using Microsoft.Xrm.Sdk;

namespace ConversationDiagnostics.Plugins.Core
{
    /// <summary>
    /// Executes KQL against the Application Insights query API using client-credentials auth.
    /// Runs inside the Dataverse sandbox (outbound HTTPS only).
    /// </summary>
    public sealed class AppInsightsClient
    {
        private const string Scope = "https://api.applicationinsights.io/.default";

        private readonly DiagnosticsConfig _config;
        private readonly ITracingService _trace;

        public AppInsightsClient(DiagnosticsConfig config, ITracingService trace)
        {
            _config = config;
            _trace = trace;
        }

        public string ExecuteQuery(string kql, TimeSpan? timespan)
        {
            var token = AcquireToken();
            string url = $"https://api.applicationinsights.io/v1/apps/{_config.AppId}/query";

            var payload = new Dictionary<string, string> { { "query", kql } };
            if (timespan.HasValue)
                payload["timespan"] = System.Xml.XmlConvert.ToString(timespan.Value); // ISO 8601 duration

            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(100) })
            {
                http.DefaultRequestHeaders.Add("Authorization", "Bearer " + token);
                var body = new StringContent(SerializeJson(payload), Encoding.UTF8, "application/json");
                var response = http.PostAsync(url, body).ConfigureAwait(false).GetAwaiter().GetResult();
                var content = response.Content.ReadAsStringAsync().ConfigureAwait(false).GetAwaiter().GetResult();

                if (!response.IsSuccessStatusCode)
                {
                    _trace.Trace("Query API returned {0}: {1}", (int)response.StatusCode, Truncate(content, 2000));
                    throw new InvalidPluginExecutionException(
                        $"Conversation Diagnostics query failed ({(int)response.StatusCode}). Check the app registration permissions and the Application Insights App ID. Details: {Truncate(content, 500)}");
                }
                return content;
            }
        }

        private string AcquireToken()
        {
            string url = $"https://login.microsoftonline.com/{_config.TenantId}/oauth2/v2.0/token";

            var form = new Dictionary<string, string>
            {
                { "grant_type", "client_credentials" },
                { "client_id", _config.ClientId },
                { "client_secret", _config.ClientSecret },
                { "scope", Scope }
            };

            using (var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) })
            {
                var response = http.PostAsync(url, new FormUrlEncodedContent(form)).ConfigureAwait(false).GetAwaiter().GetResult();
                var content = response.Content.ReadAsStringAsync().ConfigureAwait(false).GetAwaiter().GetResult();
                if (!response.IsSuccessStatusCode)
                {
                    _trace.Trace("Token endpoint returned {0}", (int)response.StatusCode);
                    throw new InvalidPluginExecutionException("Conversation Diagnostics could not authenticate to Azure. Verify tenant id, client id and secret in the Diagnostics Settings page.");
                }
                var tokenResponse = DeserializeJson<TokenResponse>(content);
                if (string.IsNullOrEmpty(tokenResponse?.access_token))
                    throw new InvalidPluginExecutionException("Conversation Diagnostics: token response did not contain an access token.");
                return tokenResponse.access_token;
            }
        }

        private static string Truncate(string s, int len) => string.IsNullOrEmpty(s) || s.Length <= len ? s : s.Substring(0, len);

        private static string SerializeJson<T>(T value)
        {
            var serializer = new DataContractJsonSerializer(typeof(T), new DataContractJsonSerializerSettings { UseSimpleDictionaryFormat = true });
            using (var ms = new System.IO.MemoryStream())
            {
                serializer.WriteObject(ms, value);
                return Encoding.UTF8.GetString(ms.ToArray());
            }
        }

        private static T DeserializeJson<T>(string json)
        {
            var serializer = new DataContractJsonSerializer(typeof(T));
            using (var ms = new System.IO.MemoryStream(Encoding.UTF8.GetBytes(json)))
                return (T)serializer.ReadObject(ms);
        }

        [DataContract]
        private sealed class TokenResponse
        {
            [DataMember] public string access_token { get; set; }
        }
    }
}

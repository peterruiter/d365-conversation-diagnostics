using System;
using System.Collections.Generic;

namespace ConversationDiagnostics.Plugins.Core
{
    /// <summary>
    /// Server-side registry of named KQL queries. Clients pass a query key, never raw KQL,
    /// so users cannot run arbitrary queries against the workspace.
    /// Query texts originate from the Microsoft FastTrack Conversation Diagnostics dashboard.
    /// </summary>
    public static class QueryLibrary
    {
        public static readonly IReadOnlyDictionary<string, string> Queries = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "ConversationStateFlow", @"traces
| where timestamp >= _startTime and timestamp <= _endTime
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]), subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
| extend scenario = tostring(customDim[""powerplatform.analytics.scenario""])
| where scenario == ""ConversationDiagnosticsScenario""
| where conversationId != """" and subscenario != """"
| project timestamp, conversationId, subscenario
| sort by timestamp asc
| summarize make_list(subscenario) by conversationId
| project conversationId, conversationFlow = strcat_array(list_subscenario, "" -> "")" },
            { "FallbackQueueRouting", @"traces
| where timestamp >= _startTime and timestamp <= _endTime
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]), 
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""]),
         queueResult = parse_json(tostring(customDim[""omnichannel.result""])).DisplayName
| extend scenario = tostring(customDim[""powerplatform.analytics.scenario""])
| where scenario == ""ConversationDiagnosticsScenario""         
| where subscenario == ""RouteToQueue"" and queueResult == ""Case Question Queue"" 
| project timestamp, conversationId, queueResult" },
            { "OverflowTriggered", @"traces
| where timestamp >= _startTime and timestamp <= _endTime
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]),
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
| extend omnichannelAdditionalInfo = tostring((customDim[""omnichannel.additional_info""]))
| extend scenario = tostring(customDim[""powerplatform.analytics.scenario""])
| where scenario == ""ConversationDiagnosticsScenario""
| where omnichannelAdditionalInfo contains ""OverflowTrigger""
| project timestamp, conversationId, subscenario, omnichannelAdditionalInfo
//add queue, and action" },
            { "MultipleRejections", @"traces
| where timestamp >= _startTime and timestamp <= _endTime
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]), 
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""]),
         agentId = tostring(customDim[""omnichannel.target_agent.id""]) // Extract agent ID from custom dimensions
| extend scenario = tostring(customDim[""powerplatform.analytics.scenario""])
| where scenario == ""ConversationDiagnosticsScenario""         
| where subscenario == ""CSRRejected""
| summarize agentRejectionCount = count() by conversationId, agentId // Count rejections per agent per conversation
| summarize rejectionCount = sum(agentRejectionCount), 
            agentRejectionDetails = make_list(pack('agentId', agentId, 'rejectionCount', agentRejectionCount)) 
    by conversationId // Aggregate results by conversation
| where rejectionCount > 1 // Filter conversations with more than one rejection
| project conversationId, rejectionCount, agentRejectionDetails





//traces
//| where timestamp >= _startTime and timestamp <= _endTime
//| extend customDim = parse_json(customDimensions)
//| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]), 
 //        subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
//| where subscenario == ""AgentReject""
//| summarize rejectionCount = count() by conversationId
//| where rejectionCount > 1
//| project conversationId, rejectionCount

//add agentid and for every agent can reject so the count of reject for every agentid
//for example
//fd29c594-8989-4582-8e4f-b9ea8acc3bc8, agent1, 2, 
//fd29c594-8989-4582-8e4f-b9ea8acc3bc8, agent2, 1," },
            { "SlowAssignment", @"// Extract relevant subscenarios
let subscenarios = traces
| where timestamp >= _startTime and timestamp <= _endTime
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]),
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
| where subscenario in (""RouteToQueue"", ""CSRAccepted"")
| project timestamp, conversationId, subscenario;
// Find the latest RTQ before each AgentAccept
let latestRTQsBeforeAgentAccept = subscenarios
| where subscenario == ""RouteToQueue""
| join kind=inner (
    subscenarios
    | where subscenario == ""CSRAccepted""
    | project agentAcceptTime = timestamp, conversationId
) on conversationId
| where timestamp < agentAcceptTime // Ensure RTQ is before AgentAccept
| summarize latestRTQTime = max(timestamp) by conversationId, agentAcceptTime;
// Calculate assignment time
latestRTQsBeforeAgentAccept
| extend assignmentTime = agentAcceptTime - latestRTQTime
| where assignmentTime > 2min
| project conversationId, assignmentTime


//| extend prevTimestamp = prev(timestamp), prevSubscenario = prev(subscenario)
//| where prevSubscenario == ""RTQ"" and subscenario == ""AgentAccept""
//| extend assignmentTime = timestamp - prevTimestamp
//| where assignmentTime > 2min
//| project conversationId, assignmentTime

//take the closest RTQ to the AgentAccept" },
            { "LongHandleTime", @"traces
| where timestamp >= _startTime and timestamp <= _endTime
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]),
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
| where subscenario in (""CSRAccepted"", ""CustomerEndedConversation"",""CSREndedConversation"") 
| project timestamp, conversationId, subscenario
| sort by conversationId, timestamp asc
| extend prevTimestamp = prev(timestamp), prevSubscenario = prev(subscenario)
| where prevSubscenario == ""CSRAccepted"" and (subscenario == ""CustomerEndedConversation"" or subscenario == ""CSREndedConversation"")
| extend handleTime = timestamp - prevTimestamp
| where handleTime > 5min
| project conversationId, handleTime" },
            { "TopRejectingAgents", @"traces
| where timestamp >= _startTime and timestamp <= _endTime
| extend customDim = parse_json(customDimensions)
| extend agentId = tostring(customDim[""omnichannel.target_agent.id""]), // Extract agent ID from custom dimensions
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
| extend scenario = tostring(customDim[""powerplatform.analytics.scenario""])
| where scenario == ""ConversationDiagnosticsScenario""
| where subscenario == ""CSRRejected""
| summarize totalRejections = count() by agentId // Count total rejections for each agent
| sort by totalRejections desc // Sort by rejection count in descending order
| top 20 by totalRejections // Select top 20 agents
| project agentId, totalRejections // Project relevant columns" },
            { "RouteToQueueDetails", @"traces  
| extend customDim = parse_json(customDimensions)  
| extend workItem = tostring(customDim[""powerplatform.analytics.resource.id""])  
| extend subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])  
| extend resultJson = parse_json(customDim[""omnichannel.result""])  
| extend finalQueueId = tostring(resultJson.Id),  
         finalQueueName = tostring(resultJson.DisplayName)  
| extend routingError = tostring(customDim[""omnichannel.description""])  // Extract routing error message  
| extend additionalInfoRaw = tostring(customDim[""omnichannel.additional_info""])  
| extend additionalInfo = parse_json(additionalInfoRaw)  
| extend ruleSetName = tostring(additionalInfo.RuleSetName),  
         ruleHitPolicy = tostring(additionalInfo.RuleHitPolicy),  
         rulesList = additionalInfo.RuleSetInfo  
| mv-expand rules = rulesList to typeof(dynamic)  
| extend ruleId = tostring(rules.RuleId),  
         ruleStatus = tostring(rules.Status),  
         ruleOrder = toint(rules.Order),  
         ruleItem = tostring(rules.RuleItem),  
         ruleCondition = tostring(rules.Condition),  
         ruleOutputs = rules.Output  
| mv-expand ruleOutputs to typeof(dynamic)  
| extend outputQueueId = tostring(ruleOutputs.Id),  
         outputQueueName = tostring(ruleOutputs.DisplayName)  
| where workItem == workitemID  
| where subscenario contains ""RouteToQueue""  
| project timestamp, workItem, subscenario, ruleSetName, ruleHitPolicy, ruleItem, ruleStatus, ruleOrder, ruleCondition, outputQueueName, outputQueueId,   routingError  
| order by timestamp asc" },
            { "ClassificationDetails", @"traces  
| extend customDim = parse_json(customDimensions)  
| extend workItem = tostring(customDim[""powerplatform.analytics.resource.id""])  
| extend subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])  
| extend classificationResult = tostring(customDim[""omnichannel.result""])  // Extract classification result  
| extend additionalInfoRaw = tostring(customDim[""omnichannel.additional_info""])  
| extend additionalInfo = parse_json(additionalInfoRaw)  
| extend ruleSetName = tostring(additionalInfo.RuleSetName),  
         ruleHitPolicy = tostring(additionalInfo.RuleHitPolicy),  
         rulesList = additionalInfo.RuleSetInfo  
| mv-expand rules = rulesList to typeof(dynamic)  
| extend ruleId = tostring(rules.RuleId),  
         ruleStatus = tostring(rules.Status),  
         ruleOrder = toint(rules.Order),  
         ruleItem = tostring(rules.RuleItem),  
         ruleCondition = tostring(rules.Condition),  
         ruleOutput = tostring(rules.Output)  
| where workItem == workitemID  // Replace with actual work item  
| where subscenario contains ""Classification""  
| project timestamp, workItem, subscenario, ruleSetName, ruleHitPolicy, ruleItem, ruleStatus, ruleOrder, ruleCondition, ruleOutput, classificationResult  
| order by timestamp asc" },
            { "AgentAssignmentDetails", @"let targetWorkItem = workitemID;  
let presenceMapping = datatable(PresenceId: string, PresenceName: string)
[
    ""f523f628-c07a-e811-8162-000d3aa11f50"", ""Available"",
    ""efdeb843-c07a-e811-8162-000d3aa11f50"", ""Busy"",
    ""08971864-c07a-e811-8162-000d3aa11f50"", ""Busy DND"",
    ""70139190-c07a-e811-8162-000d3aa11f50"", ""Offline"",
    ""3dacae76-c07a-e811-8162-000d3aa11f50"", ""Away""
];
traces
| extend customDim = parse_json(customDimensions)  
| extend workItem = tostring(customDim[""powerplatform.analytics.resource.id""])  
| where workItem == targetWorkItem  
| extend subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])  
| extend assignmentMethod = tostring(customDim[""omnichannel.assignment.method""])  
| extend assignmentStatusRaw = tostring(customDim[""omnichannel.assignment.status""])  
| extend assignmentStatus = iff(isnotempty(assignmentStatusRaw), parse_json(assignmentStatusRaw), dynamic({}))  
| extend isAgentAssigned = tostring(assignmentStatus.IsAgentAssigned),
         agentId = tostring(assignmentStatus.AgentDetails.AgentId),
         aadUserId = tostring(assignmentStatus.AgentDetails.AadUserId),
         agentCapacity = toint(assignmentStatus.AgentDetails.AvailableCapacity),
         agentPresence = tostring(assignmentStatus.AgentDetails.CurrentPresence)  
// Fetch Rule Sets from omnichannel.rule_sets
| extend ruleSetsRaw = tostring(customDim[""omnichannel.rule_sets""])  
| extend ruleSets = iff(isnotempty(ruleSetsRaw) and ruleSetsRaw != ""[]"", parse_json(ruleSetsRaw), dynamic([{}]))  
| mv-expand rules = ruleSets to typeof(dynamic)  
| extend ruleStatus = tostring(rules.Status),  
         ruleOrder = toint(rules.Order),  
         ruleItem = tostring(rules.RuleItem),  
         ruleCondition = tostring(rules.Condition),  
         ruleOutput = tostring(rules.Output),  
         ruleOrderBy = tostring(rules.OrderBy)  
| where subscenario in (""NewWorkItemTrigger"", ""AgentAvailabilityTrigger"",""AgentAssignment"",""CSRAssignment"")  
| join kind=leftouter presenceMapping on $left.agentPresence == $right.PresenceId
| extend currentAgentPresence = iff(isnotempty(PresenceName), PresenceName, ""Unknown"") 
| project timestamp, workItem, subscenario, assignmentMethod, isAgentAssigned, agentId, agentCapacity, currentAgentPresence, ruleStatus, ruleOrder, ruleItem, ruleCondition, ruleOutput, ruleOrderBy  
| order by timestamp asc" },
            { "IncomingWorkItems", @"// Extract final identified queue from RTQ events
let FinalQueueMapping = materialize(
    traces  
    | where timestamp >= _startTime and timestamp <=_endTime  // Ensures _timeRange is used in a table
    | extend customDim = parse_json(customDimensions)
    | extend workItem = tostring(customDim[""powerplatform.analytics.resource.id""]), 
             subscenario = tostring(customDim[""powerplatform.analytics.subscenario""]),
             queueInfoRaw = tostring(customDim[""omnichannel.result""])
    | where subscenario == ""RouteToQueue"" and isnotempty(queueInfoRaw)
    | extend queueInfo = parse_json(queueInfoRaw)
    | project workItem, finalQueueId = tostring(queueInfo.Id), finalQueueName = tostring(queueInfo.DisplayName)
    | summarize finalQueueId = any(finalQueueId), finalQueueName = any(finalQueueName) by workItem
);

// Main query to track conversation flow
traces  
| where timestamp >= _startTime and timestamp <=_endTime
| extend customDim = parse_json(customDimensions)
| extend channelType = tostring(customDim[""omnichannel.channel.type""])
| extend scenario = tostring(customDim[""powerplatform.analytics.scenario""])
| extend workItem = tostring(customDim[""powerplatform.analytics.resource.id""]), 
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
| where workItem !in ("""", ""00000000-0000-0000-0000-000000000000"")
      and scenario == ""ConversationDiagnosticsScenario""
| extend channelTypeForConversation = iff(subscenario == ""ConversationCreated"", channelType, """")
| project timestamp, workItem, subscenario, channelTypeForConversation
| sort by timestamp asc  
| summarize 
    conversationFlow = make_list(subscenario), 
    lastUpdatedTime = max(timestamp),  
    channelType = arg_max(channelTypeForConversation,timestamp)
  by workItem
| project 
    workItem, 
    lastUpdatedTime, 
    channelType,
    conversationFlow = strcat_array(conversationFlow, "" -> "")
| join kind=leftouter (FinalQueueMapping) on workItem  
| project workItem, lastUpdatedTime, channelType, finalQueueName, conversationFlow
| sort by lastUpdatedTime desc" },
            { "WorkItemTimeline", @"let _conversationId = workitemID;
traces
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]),
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""])
| where conversationId == _conversationId and subscenario != """"
| project timestamp, subscenario
| order by timestamp asc
| serialize
| extend  prevSub = prev(subscenario)
| extend occurrenceNumber =  1
//| extend occurrenceNumber = row_cumsum(iif(prev(subscenario) == subscenario and subscenario != ""ConversationCreated"", 1, 0)) + 1
| extend rNumber = row_number(0)
| extend subscenarioIndexed = iif(subscenario == ""ConversationCreated"", subscenario, strcat(subscenario, "" "", tostring(rNumber)))  // No index for ""ConversationCreated""
| extend prevTimestamp = prev(timestamp)
| extend timeSpent = iif(isnull(prevTimestamp), 0, datetime_diff('second', timestamp, prevTimestamp))
| extend cumulativeTimeSpent = row_cumsum(timeSpent)  // Cumulative sum of time spent
| project occurrenceNumber, subscenarioIndexed, timeSpent, cumulativeTimeSpent, prevSub, rNumber" },
            { "ConversationEvents", @"traces
| extend customDim = parse_json(customDimensions)
| extend conversationId = tostring(customDim[""powerplatform.analytics.resource.id""]),
         subscenario = tostring(customDim[""powerplatform.analytics.subscenario""]),
         scenario = tostring(customDim[""powerplatform.analytics.scenario""])
| where conversationId == workitemID and scenario == ""ConversationDiagnosticsScenario""
| project timestamp, message, subscenario, customDimensions
| order by timestamp asc" },
        };

        /// <summary>Prepends let-bindings for the parameters the FastTrack queries expect.</summary>
        public static string Bind(string queryKey, DateTime startUtc, DateTime endUtc, Guid? workItemId)
        {
            if (!Queries.TryGetValue(queryKey, out var kql))
                throw new ArgumentException($"Unknown query key '{queryKey}'.");

            var header = $"let _startTime = datetime({startUtc:yyyy-MM-ddTHH:mm:ssZ});\n" +
                         $"let _endTime = datetime({endUtc:yyyy-MM-ddTHH:mm:ssZ});\n";
            if (workItemId.HasValue)
                header += $"let workitemID = \"{workItemId.Value:D}\";\n";
            else if (kql.Contains("workitemID"))
                throw new ArgumentException($"Query '{queryKey}' requires a WorkItemId parameter.");
            return header + kql;
        }
    }
}
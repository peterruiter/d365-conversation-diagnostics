/* Deterministic explanation engine.
   Turns the ordered ConversationDiagnosticsScenario event stream into a
   human-readable account of what the routing engine did and why.
   No AI involved: every sentence maps 1:1 to telemetry facts. */

import { DiagnosticsEvent } from "./api";

export interface TimelineStep {
  timestamp: string;
  subscenario: string;
  label: string;
  detail: string;
  status: "info" | "success" | "warning" | "error";
  secondsFromStart: number;
  raw: DiagnosticsEvent;
}

export interface Explanation {
  steps: TimelineStep[];
  narrative: string[];
  metrics: { label: string; value: string }[];
  warnings: string[];
}

const dim = (e: DiagnosticsEvent, key: string): string => {
  const v = e.customDimensions[key];
  return v === undefined || v === null ? "" : String(v);
};

const parseJsonDim = (e: DiagnosticsEvent, key: string): Record<string, unknown> | null => {
  const raw = dim(e, key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

function seconds(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

function fmtDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m} min ${s} s`;
}

export function explain(events: DiagnosticsEvent[]): Explanation {
  const steps: TimelineStep[] = [];
  const narrative: string[] = [];
  const warnings: string[] = [];
  const metrics: { label: string; value: string }[] = [];

  if (events.length === 0) {
    return {
      steps, metrics, warnings,
      narrative: ["No diagnostics events found for this id in the selected time range. Check the conversation id and confirm telemetry export is running."]
    };
  }

  const t0 = events[0].timestamp;
  let created: DiagnosticsEvent | null = null;
  let accepted: DiagnosticsEvent | null = null;
  let ended: DiagnosticsEvent | null = null;
  let routedQueue = "";
  let rejectCount = 0;

  for (const e of events) {
    const s = e.subscenario;
    const step: TimelineStep = {
      timestamp: e.timestamp,
      subscenario: s,
      label: s,
      detail: "",
      status: "info",
      secondsFromStart: seconds(t0, e.timestamp),
      raw: e
    };

    switch (true) {
      case s === "ConversationCreated" || s === "CreateConversation": {
        created = e;
        const channel = dim(e, "omnichannel.channel.type");
        step.label = "Conversation created";
        step.detail = channel ? `Channel: ${channel}` : "";
        narrative.push(`The conversation arrived${channel ? ` on the ${channel} channel` : ""} at ${e.timestamp} (UTC).`);
        break;
      }

      case s.indexOf("Classification") >= 0: {
        const info = parseJsonDim(e, "omnichannel.additional_info");
        const ruleSet = info ? String(info["RuleSetName"] ?? "") : "";
        const hitPolicy = info ? String(info["RuleHitPolicy"] ?? "") : "";
        const rules = info && Array.isArray(info["RuleSetInfo"]) ? (info["RuleSetInfo"] as Record<string, unknown>[]) : [];
        const applied = rules.filter((r) => String(r["Status"]) === "Applied");
        step.label = "Work classification";
        step.detail = ruleSet ? `Rule set: ${ruleSet} (${hitPolicy})` : "";
        if (applied.length > 0) {
          step.status = "success";
          for (const r of applied) {
            narrative.push(
              `Classification rule set "${ruleSet}" ran with hit policy ${hitPolicy}. ` +
              `Rule "${r["RuleItem"]}" (order ${r["Order"]}) matched because the condition [${r["Condition"]}] was true, ` +
              `so the engine applied output: ${r["Output"]}.`
            );
          }
        } else if (rules.length > 0) {
          step.status = "warning";
          narrative.push(`Classification rule set "${ruleSet}" ran, but no rule matched. Work item attributes stayed unchanged.`);
        }
        break;
      }

      case s === "RouteToQueue" || s === "RTQ": {
        const result = parseJsonDim(e, "omnichannel.result");
        const info = parseJsonDim(e, "omnichannel.additional_info");
        const queueName = result ? String(result["DisplayName"] ?? "") : "";
        const ruleSet = info ? String(info["RuleSetName"] ?? "") : "";
        const hitPolicy = info ? String(info["RuleHitPolicy"] ?? "") : "";
        const rules = info && Array.isArray(info["RuleSetInfo"]) ? (info["RuleSetInfo"] as Record<string, unknown>[]) : [];
        const applied = rules.filter((r) => String(r["Status"]) === "Applied");
        routedQueue = queueName;
        step.label = "Route to queue";
        step.detail = queueName ? `Queue: ${queueName}` : "";
        if (applied.length > 0) {
          step.status = "success";
          const r = applied[applied.length - 1];
          narrative.push(
            `Route-to-queue rule set "${ruleSet}" (${hitPolicy}) evaluated. Rule "${r["RuleItem"]}" matched on [${r["Condition"]}], ` +
            `so the work item routed to queue "${queueName}".`
          );
        } else {
          const isDefault = /default/i.test(queueName);
          step.status = isDefault ? "warning" : "info";
          narrative.push(
            isDefault
              ? `No route-to-queue rule matched, so the work item fell back to "${queueName}". If this is unexpected, review the rule conditions against the work item attributes at classification time.`
              : `The work item routed to queue "${queueName}".`
          );
          if (isDefault) warnings.push("Fallback/default queue used — no RTQ rule matched.");
        }
        const routingError = info ? String(info["RoutingError"] ?? "") : "";
        if (routingError) {
          step.status = "error";
          warnings.push(`Routing error: ${routingError}`);
          narrative.push(`The routing engine reported an error during queue routing: ${routingError}.`);
        }
        break;
      }

      case s === "NewWorkItemTrigger" || s.indexOf("Assignment") >= 0: {
        const method = dim(e, "omnichannel.assignment_method") || pickFromResult(e, "AssignmentMethod");
        const agentId = dim(e, "omnichannel.target_agent.id");
        const capacity = dim(e, "omnichannel.agent_capacity") || pickFromResult(e, "AgentCapacity");
        const presence = dim(e, "omnichannel.agent_presence") || pickFromResult(e, "CurrentAgentPresence");
        step.label = "Assignment evaluation";
        step.detail = agentId ? `Agent: ${agentId}` : "";
        if (agentId) {
          step.status = "success";
          narrative.push(
            `Assignment ran${method ? ` with method "${method}"` : ""} and selected agent ${agentId}` +
            `${capacity ? ` (remaining capacity ${capacity}${presence ? `, presence ${presence}` : ""})` : ""}. ` +
            `The engine picked this agent because they ranked highest under the queue's assignment method among eligible agents (skills, presence and capacity checks passed).`
          );
        } else {
          step.status = "warning";
          narrative.push(
            `Assignment ran but found no eligible agent. Typical causes: no agent with matching skills, all agents at capacity, or presence excluded by the assignment rules. The item stayed in queue "${routedQueue}".`
          );
          warnings.push("Assignment cycle completed without an eligible agent.");
        }
        break;
      }

      case s === "CSRRejected" || s === "AgentRejected": {
        rejectCount++;
        const agentId = dim(e, "omnichannel.target_agent.id");
        step.label = "Agent rejected";
        step.status = "warning";
        step.detail = agentId ? `Agent: ${agentId}` : "";
        narrative.push(`Agent ${agentId || "(unknown)"} rejected or timed out on the assignment. The engine returned the item for re-assignment.`);
        break;
      }

      case s === "CSRAccepted" || s === "AgentAccept": {
        accepted = e;
        const agentId = dim(e, "omnichannel.target_agent.id");
        step.label = "Agent accepted";
        step.status = "success";
        step.detail = agentId ? `Agent: ${agentId}` : "";
        narrative.push(`Agent ${agentId || ""} accepted the conversation ${fmtDuration(step.secondsFromStart)} after creation.`.replace("  ", " "));
        break;
      }

      case s === "CustomerEndedConversation" || s === "CSREndedConversation" || s === "AgentCloseSession" || s === "CloseConversation": {
        if (!ended) ended = e;
        step.label = s === "CustomerEndedConversation" ? "Customer ended conversation" : "Conversation closed";
        narrative.push(`${step.label} at ${e.timestamp} (UTC).`);
        break;
      }

      default: {
        const info = dim(e, "omnichannel.additional_info");
        if (info.indexOf("OverflowTrigger") >= 0) {
          step.status = "warning";
          step.label = `${s} (overflow)`;
          warnings.push("Queue overflow condition triggered for this conversation.");
          narrative.push(`An overflow condition triggered during "${s}". Review the queue's overflow settings; the configured overflow action applied here.`);
        }
      }
    }

    steps.push(step);
  }

  // Metrics
  if (created && accepted) metrics.push({ label: "Time to accept", value: fmtDuration(seconds(created.timestamp, accepted.timestamp)) });
  if (accepted && ended) metrics.push({ label: "Handle time", value: fmtDuration(seconds(accepted.timestamp, ended.timestamp)) });
  if (created && ended) metrics.push({ label: "Total duration", value: fmtDuration(seconds(created.timestamp, ended.timestamp)) });
  if (routedQueue) metrics.push({ label: "Final queue", value: routedQueue });
  if (rejectCount > 0) {
    metrics.push({ label: "Rejections", value: String(rejectCount) });
    if (rejectCount >= 2) warnings.push(`${rejectCount} agent rejections before acceptance — review capacity profiles and auto-accept settings.`);
  }
  if (accepted && created && seconds(created.timestamp, accepted.timestamp) > 120)
    warnings.push("Agent assignment took longer than 2 minutes.");
  if (accepted && ended && seconds(accepted.timestamp, ended.timestamp) > 300)
    warnings.push("Handle time exceeded 5 minutes.");

  return { steps, narrative, metrics, warnings };
}

function pickFromResult(e: DiagnosticsEvent, key: string): string {
  const result = e.customDimensions["omnichannel.result"];
  if (typeof result !== "string") return "";
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    return parsed[key] !== undefined ? String(parsed[key]) : "";
  } catch { return ""; }
}

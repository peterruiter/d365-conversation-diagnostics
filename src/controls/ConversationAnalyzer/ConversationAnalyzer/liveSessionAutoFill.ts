/* Supported (not experimental) live-session auto-fill for the productivity pane.

   Microsoft documents Microsoft.Omnichannel.getConversationId() as returning the id of
   the currently ongoing conversation in the focused session:
   https://learn.microsoft.com/dynamics365/customer-service/developer/reference/methods/getconversationid
   Confirmed callable directly from a pane-hosted PCF via window.parent, against a real
   live agent session. This supersedes an earlier same-origin BroadcastChannel relay
   (a separate form web resource plus a custom message schema/freshness-TTL/focus-match
   layer) - all of that existed only to compensate for the relay's own staleness risk.
   Calling Microsoft's API directly needs none of it: it always answers for "right now,"
   so every check is either current or empty.

   Scope, and why this is not the primary route: getConversationId() only ever resolves
   for a genuinely *ongoing* conversation. Once a conversation closes - which in practice
   is when most diagnostics lookups happen here, since Application Insights telemetry
   lags behind the live session - it resolves to nothing. That is not a bug to work
   around; it is what the API is for. Looking up a closed conversation's diagnostics is
   what binding the control on the msdyn_ocliveworkitem form, or the navigateTo launch
   route, are for (see README Known limits and docs/setup-app-profile.md) - both are
   record-scoped, not session-scoped, so they work identically whether the conversation
   is open, closed, or a week old. This module exists purely as a convenience for the
   pane during a live conversation.

   Also follows Microsoft's documented ON_SESSION_SWITCH event (via
   Microsoft.Apm.getEventPublisherTopic, reached the same way as Omnichannel above) so
   a representative switching into a different live session re-triggers the lookup - the
   pane persists across session switches and the PCF's own init()/updateView() lifecycle
   has no reason to fire again on a session switch, so without this the pane would only
   ever reflect whichever session was focused when it first loaded. */

import { GUID_RE } from "./idParser";

function getHostGlobal<T>(path: string[]): T | undefined {
  const roots: unknown[] = [window.parent, window];
  for (const root of roots) {
    try {
      let value: unknown = root;
      for (const key of path) {
        if (value == null) break;
        value = (value as Record<string, unknown>)[key];
      }
      if (typeof value === "function") return value as T;
    } catch {
      // Not reachable from this root (cross-origin or undefined) - try the next one.
    }
  }
  return undefined;
}

export class LiveSessionAutoFill {
  private switchChannel: BroadcastChannel | null = null;

  constructor(
    private readonly onConversationId: (id: string) => void,
    private readonly onError: (message: string) => void
  ) {}

  public start(): void {
    void this.checkNow();
    this.subscribeSessionSwitch();
  }

  /** Asks Microsoft.Omnichannel.getConversationId() for the currently ongoing
      conversation. A rejection here is the expected, common case (no Omnichannel
      session focused, or a closed conversation) - not surfaced as an error. */
  public async checkNow(): Promise<void> {
    const getConversationId = getHostGlobal<() => Promise<string>>(["Microsoft", "Omnichannel", "getConversationId"]);
    if (!getConversationId) return;
    try {
      const raw = await getConversationId();
      const id = raw ? raw.replace(/[{}]/g, "").toLowerCase() : "";
      if (GUID_RE.test(id)) this.onConversationId(id);
    } catch {
      // No ongoing conversation in the focused session right now - normal, not an error.
    }
  }

  private subscribeSessionSwitch(): void {
    const getEventPublisherTopic = getHostGlobal<(name: string) => string>(["Microsoft", "Apm", "getEventPublisherTopic"]);
    if (!getEventPublisherTopic) return; // no APM host - live auto-fill just never fires; manual search is unaffected
    try {
      const topic = getEventPublisherTopic("ON_SESSION_SWITCH");
      this.switchChannel = new BroadcastChannel(topic);
      this.switchChannel.onmessage = () => void this.checkNow();
    } catch (err) {
      this.onError(`Session switch tracking unavailable: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  public destroy(): void {
    if (this.switchChannel) {
      try {
        this.switchChannel.close();
      } catch (err) {
        this.onError(`Live auto-fill cleanup failed: ${(err as Error)?.message ?? String(err)}`);
      }
      this.switchChannel = null;
    }
  }
}

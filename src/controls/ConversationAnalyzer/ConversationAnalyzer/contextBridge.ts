/* EXPERIMENTAL, opt-in same-origin BroadcastChannel context bridge.

   This is not the supported route (see index.ts / README "Known limits"). It exists
   because Microsoft documents no supported way for a productivity pane tool to read
   session context (docs/architecture.md "Productivity pane constraint"). The bridge
   is a best-effort companion: a form-side script on msdyn_ocliveworkitem
   (pwr_conversationcontext_bridge.js, see src/webresources) publishes its own record
   id on a same-origin BroadcastChannel; this client listens for it only when the
   control's enableContextBridge input is explicitly turned on.

   Compatibility-dependent: relies on BroadcastChannel being available and the pane
   iframe sharing an origin with the form that publishes (true for standard CSW/model-
   driven app hosting, not guaranteed for every deployment or future Microsoft change).

   Rules this module enforces so a stale or hostile message can never take over the
   analyzer silently:
   - Messages must match the versioned shape exactly (isStateMessage) - anything else
     is dropped, not surfaced as an error (foreign BroadcastChannel traffic on the same
     origin is expected, not exceptional).
   - conversationId (and sessionId, if present) must be well-formed GUIDs.
   - Messages older than FRESHNESS_TTL_MS are dropped as stale.
   - Only messages with focused === true are ever handed to the caller; index.ts additionally
     never overwrites a manually-typed id (see manualOverride there).
   Genuine failures (BroadcastChannel unsupported, postMessage throwing, an unexpected
   exception) are reported via onError instead of being swallowed. */

import { GUID_RE } from "./idParser";

export const CONTEXT_BRIDGE_TOPIC = "pwr.conversationcontext.v1";
const MESSAGE_VERSION = 1;
/** Messages older than this are treated as stale and ignored, so a form tab left open
    in the background can never resurrect an old conversation into the pane. */
const FRESHNESS_TTL_MS = 5000;

export interface BridgeContext {
  conversationId: string;
  sessionId?: string;
  focused: boolean;
  ts: number;
}

interface RequestMessage {
  v: number;
  type: "request";
}

interface RawStateMessage {
  v: unknown;
  type: unknown;
  conversationId: unknown;
  sessionId?: unknown;
  focused: unknown;
  ts: unknown;
}

function isStateMessage(data: unknown): data is RawStateMessage {
  return !!data && typeof data === "object" && (data as RawStateMessage).type === "state" && (data as RawStateMessage).v === MESSAGE_VERSION;
}

/** Validates and normalizes a raw state message. Returns null for anything malformed
    or stale rather than throwing - callers treat null as "ignore this message". */
function toBridgeContext(msg: RawStateMessage): BridgeContext | null {
  const conversationId = String(msg.conversationId ?? "").toLowerCase();
  if (!GUID_RE.test(conversationId)) return null;

  const ts = Number(msg.ts);
  if (!Number.isFinite(ts)) return null;
  if (Date.now() - ts > FRESHNESS_TTL_MS) return null;

  let sessionId: string | undefined;
  if (typeof msg.sessionId === "string" && GUID_RE.test(msg.sessionId)) sessionId = msg.sessionId.toLowerCase();

  return { conversationId, sessionId, focused: msg.focused === true, ts };
}

/** Client half of the bridge, run from the pane PCF. Only ever active when the host
    control explicitly enables it. */
export class ContextBridgeClient {
  private channel: BroadcastChannel | null = null;

  constructor(
    private readonly onContext: (ctx: BridgeContext) => void,
    private readonly onError: (message: string) => void
  ) {}

  public start(): void {
    if (typeof BroadcastChannel === "undefined") {
      this.onError("Context bridge unavailable: this browser does not support BroadcastChannel.");
      return;
    }
    try {
      this.channel = new BroadcastChannel(CONTEXT_BRIDGE_TOPIC);
      this.channel.onmessage = (evt: MessageEvent) => this.handleMessage(evt.data);
      this.channel.onmessageerror = () => this.onError("Context bridge received a message it could not deserialize.");
      const request: RequestMessage = { v: MESSAGE_VERSION, type: "request" };
      this.channel.postMessage(request);
    } catch (err) {
      this.onError(`Context bridge failed to start: ${(err as Error).message}`);
    }
  }

  private handleMessage(data: unknown): void {
    if (!isStateMessage(data)) return; // not our message shape - ordinary same-origin channel traffic, not an error
    const ctx = toBridgeContext(data);
    if (!ctx) return; // malformed or stale - drop silently per the freshness/validation contract above
    this.onContext(ctx);
  }

  public destroy(): void {
    if (this.channel) {
      try {
        this.channel.close();
      } catch (err) {
        this.onError(`Context bridge cleanup failed: ${(err as Error).message}`);
      }
      this.channel = null;
    }
  }
}

/* Conversation Analyzer - EXPERIMENTAL context bridge publisher (form-side JS web
 * resource). OPT-IN. Do not wire this onto the Conversation form unless you have
 * read docs/architecture.md "Experimental context bridge" and accept its
 * compatibility and staleness risks.
 *
 * Wire Pwr.ConversationContextBridge.onLoad as an OnLoad handler (and, optionally,
 * onSave as an OnSave handler for a freshness heartbeat) on the msdyn_ocliveworkitem
 * ("Conversation") form. Wire onUnload as an OnUnload handler so the channel is
 * always closed.
 *
 * What it does:
 *   - Reads the conversation (work item) id from the form that is currently loaded.
 *   - Publishes a small, versioned message on a same-origin BroadcastChannel
 *     (topic "pwr.conversationcontext.v1") that the ConversationAnalyzer PCF can
 *     listen for when its enableContextBridge input is turned on.
 *   - Responds to a handshake request from the pane so it doesn't have to wait for
 *     the next publish.
 *   - Best-effort tracks the Copilot Service workspace App Profile Manager (APM)
 *     session id via Microsoft.Apm, and re-publishes on the officially documented
 *     ON_SESSION_SWITCH event so the pane can tell whether this record's session is
 *     the one currently focused:
 *     https://learn.microsoft.com/dynamics365/customer-service/develop/microsoft-apm
 *     https://learn.microsoft.com/dynamics365/customer-service/develop/reference/events/on_session_switch
 *
 * This is NOT the supported route (see README "Known limits" and
 * docs/architecture.md). Microsoft documents no supported way for a productivity
 * pane tool to read session context; this bridge is a best-effort companion that
 * depends on same-origin BroadcastChannel behavior Microsoft could change at any
 * time. Errors are logged loudly (never swallowed) so a broken bridge is visible
 * in the browser console instead of silently doing nothing.
 */
"use strict";
var Pwr = window.Pwr || {};

Pwr.ConversationContextBridge = (function () {
  var TOPIC = "pwr.conversationcontext.v1";
  var VERSION = 1;
  var GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var channel = null;
  var apmSwitchChannel = null;
  var conversationId = null;
  var focusedSessionId = null; // best-effort: the APM session id this form last saw itself in

  function log(message, err) {
    // Deliberately console.error (not a silent catch) - a broken bridge should be
    // discoverable by whoever wired it up, without disrupting the form otherwise.
    if (err) console.error("[pwr-context-bridge] " + message, err);
    else console.error("[pwr-context-bridge] " + message);
  }

  function getApm() {
    try {
      return (window.parent && window.parent.Microsoft && window.parent.Microsoft.Apm) || (window.Microsoft && window.Microsoft.Apm) || null;
    } catch (err) {
      log("could not access Microsoft.Apm (cross-origin or unavailable)", err);
      return null;
    }
  }

  function publish(focused) {
    if (!channel || !conversationId) return;
    var message = {
      v: VERSION,
      type: "state",
      conversationId: conversationId,
      sessionId: focusedSessionId || undefined,
      focused: !!focused,
      ts: Date.now()
    };
    try {
      channel.postMessage(message);
    } catch (err) {
      log("postMessage failed", err);
    }
  }

  function onChannelMessage(evt) {
    var data = evt && evt.data;
    if (!data || data.v !== VERSION) return; // not one of ours - ordinary same-origin traffic
    if (data.type === "request") publish(true);
  }

  /** Best-effort: ask APM which session is focused and record it if it matches this
      form's own load. getFocusedSession's return shape has varied across releases,
      so this tolerates both a direct object and a promise. */
  function captureFocusedSession() {
    var apm = getApm();
    if (!apm || typeof apm.getFocusedSession !== "function") return;
    try {
      var result = apm.getFocusedSession();
      if (result && typeof result.then === "function") {
        result.then(function (session) {
          if (session && session.sessionId) { focusedSessionId = session.sessionId; publish(true); }
        }, function (err) { log("getFocusedSession rejected", err); });
      } else if (result && result.sessionId) {
        focusedSessionId = result.sessionId;
      }
    } catch (err) {
      log("getFocusedSession threw", err);
    }
  }

  /** Subscribes to Microsoft's own documented ON_SESSION_SWITCH BroadcastChannel so
      this form can tell the pane "I'm focused now" / "I've lost focus" without
      polling. Isolated in its own try/catch: if Microsoft.Apm is unavailable (e.g.
      outside Copilot Service workspace, or a future breaking change), the bridge
      still publishes on load/save, just without focus tracking. */
  function subscribeSessionSwitch() {
    var apm = getApm();
    if (!apm || typeof apm.getEventPublisherTopic !== "function") {
      log("Microsoft.Apm.getEventPublisherTopic is unavailable; continuing without ON_SESSION_SWITCH tracking.");
      return;
    }
    try {
      var topic = apm.getEventPublisherTopic("ON_SESSION_SWITCH");
      apmSwitchChannel = new BroadcastChannel(topic);
      apmSwitchChannel.onmessage = function (evt) {
        var data = evt && evt.data;
        if (!data) return;
        if (focusedSessionId && data.newSessionId === focusedSessionId) publish(true);
        else if (focusedSessionId && data.previousSessionId === focusedSessionId) publish(false);
      };
    } catch (err) {
      log("ON_SESSION_SWITCH subscription failed; continuing without it", err);
    }
  }

  function onLoad(executionContext) {
    if (typeof BroadcastChannel === "undefined") {
      log("BroadcastChannel is not available in this browser; the experimental context bridge is disabled.");
      return;
    }
    try {
      var formContext = executionContext.getFormContext();
      var rawId = formContext.data.entity.getId();
      var id = rawId ? rawId.replace(/[{}]/g, "").toLowerCase() : "";
      if (!GUID_RE.test(id)) { log("form has no valid record id yet (new/unsaved record) - not publishing"); return; }
      conversationId = id;

      channel = new BroadcastChannel(TOPIC);
      channel.onmessage = onChannelMessage;

      captureFocusedSession();
      subscribeSessionSwitch();
      publish(true);
    } catch (err) {
      log("onLoad failed", err);
    }
  }

  /** Optional OnSave heartbeat: re-publishes so a long-open form stays "fresh"
      against the pane's freshness TTL. */
  function onSave() {
    publish(true);
  }

  function onUnload() {
    if (channel) {
      try { channel.close(); } catch (err) { log("closing channel failed", err); }
      channel = null;
    }
    if (apmSwitchChannel) {
      try { apmSwitchChannel.close(); } catch (err) { log("closing ON_SESSION_SWITCH channel failed", err); }
      apmSwitchChannel = null;
    }
    conversationId = null;
    focusedSessionId = null;
  }

  return { onLoad: onLoad, onSave: onSave, onUnload: onUnload };
})();

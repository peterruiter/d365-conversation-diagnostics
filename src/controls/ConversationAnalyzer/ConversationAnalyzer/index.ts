import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { getConversationDiagnostics, DiagnosticsEvent } from "./api";
import { explain, Explanation } from "./explainEngine";
import { extractConversationId, GUID_RE } from "./idParser";
import { LiveSessionAutoFill } from "./liveSessionAutoFill";

/* Conversation Analyzer
   Hosts in three places with the same code:
   1. Custom page "Conversation Analyzer" (search box visible), bindable to
      Param("recordId") when opened via Xrm.Navigation.navigateTo - see README.
   2. Productivity pane tool in Customer Service workspace
   3. Opened directly with ?pwr_id=<guid> where the host allows it

   The record-scoped routes above (bound conversationId input, ?pwr_id, and
   Xrm.Navigation.navigateTo behind both) are the primary way to get a conversation in
   here, because they work identically whether the conversation is open, closed, or a
   week old - and since Application Insights telemetry lags behind the live session,
   most real lookups happen after the conversation has already closed. See README
   Known limits.

   When the control has no bound/URL id - which only ever happens when it's hosted as
   a pane tool, since both the custom page and a form binding always resolve an id -
   it tries a supported, live-only convenience: Microsoft.Omnichannel.getConversationId()
   (see liveSessionAutoFill.ts) resolves the ongoing conversation in the focused session
   directly, no relay needed. This is unconditional rather than an opt-in control
   property: msdyn_panetoolconfiguration (the "Pane tool configuration" record a Control-
   type pane tool is registered with) has no field to set a custom control's input
   properties, so a toggle here would be permanently stuck at its default for the one
   host it matters in. It never overrides a manually-typed id - typing or pasting into
   the search box always wins, immediately, with no extra step - and because the API
   only ever answers for an *ongoing* conversation, it naturally does nothing once that
   conversation closes.

   The pane can also open before the conversation session has finished loading, so a
   single check on load is not enough - getConversationId() legitimately has nothing to
   answer for the first few seconds. AUTOFILL_POLL_MS re-checks while the box is still
   empty and stops the moment it either finds an id or the representative starts typing. */

const AUTOFILL_POLL_MS = 1000;

export class ConversationAnalyzer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private currentId = "";
  private manualOverride = false;
  private autoFill: LiveSessionAutoFill | null = null;
  private autoFillPollTimer: ReturnType<typeof setInterval> | null = null;

  public init(context: ComponentFramework.Context<IInputs>, _notify: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.container = container;
    this.container.classList.add("pwr-analyzer");
    this.renderShell();

    const bound = context.parameters.conversationId?.raw ?? "";
    const fromUrl = new URLSearchParams(window.location.search).get("pwr_id") ?? "";
    const resolved = bound || fromUrl;
    if (resolved) {
      void this.load(resolved);
    } else {
      this.startAutoFill();
    }
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const bound = context.parameters.conversationId?.raw ?? "";
    if (bound && bound !== this.currentId) {
      this.stopAutoFill();
      this.load(bound);
    }
  }

  public getOutputs(): IOutputs { return {}; }
  public destroy(): void { this.stopAutoFill(); }

  private startAutoFill(): void {
    this.autoFill = new LiveSessionAutoFill(
      (id) => this.onAutoFillId(id),
      (message) => this.showAutoFillError(message)
    );
    this.autoFill.start();
    this.startAutoFillPolling();
  }

  private stopAutoFill(): void {
    this.stopAutoFillPolling();
    this.autoFill?.destroy();
    this.autoFill = null;
  }

  /** The pane can open before the conversation session finishes loading, so the first
      checkNow() (in LiveSessionAutoFill.start()) commonly finds nothing yet. Keep
      re-checking once a second until either an id shows up or a person starts typing -
      whichever the input field ends up holding, not just what auto-fill produced. */
  private startAutoFillPolling(): void {
    this.stopAutoFillPolling();
    this.autoFillPollTimer = setInterval(() => {
      if (this.manualOverride || this.currentId) { this.stopAutoFillPolling(); return; }
      void this.autoFill?.checkNow();
    }, AUTOFILL_POLL_MS);
  }

  private stopAutoFillPolling(): void {
    if (this.autoFillPollTimer !== null) {
      clearInterval(this.autoFillPollTimer);
      this.autoFillPollTimer = null;
    }
  }

  private onAutoFillId(id: string): void {
    if (this.manualOverride) return; // a person already took over - never snatch the box back
    if (this.currentId && this.currentId.toLowerCase() === id) return; // already showing it
    void this.load(id);
  }

  private showAutoFillError(message: string): void {
    const banner = this.container.querySelector<HTMLElement>(".pwr-autofill-error");
    if (!banner) return;
    banner.hidden = false;
    banner.textContent = message;
  }

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="pwr-autofill-error" hidden></div>
      <div class="pwr-search">
        <input type="text" class="pwr-input" placeholder="Paste a conversation ID or the conversation URL (Copy link)" aria-label="Conversation ID or conversation URL" />
        <button class="pwr-btn" type="button">Analyze</button>
      </div>
      <div class="pwr-body"><div class="pwr-empty">Paste a conversation ID, or the conversation URL from the <b>Copy link</b> button, to see its routing story.</div></div>`;
    const input = this.container.querySelector<HTMLInputElement>(".pwr-input");
    const btn = this.container.querySelector<HTMLButtonElement>(".pwr-btn");
    const go = () => {
      const typed = input?.value ?? "";
      if (!typed.trim()) return;
      const id = extractConversationId(typed);
      if (!id) {
        const body = this.container.querySelector<HTMLDivElement>(".pwr-body");
        if (body) body.innerHTML = `<div class="pwr-error">No conversation id found in that text. Paste the id, or the record URL from the Copy link button.</div>`;
        return;
      }
      this.manualOverride = true;
      this.stopAutoFillPolling();
      this.load(id);
    };
    btn?.addEventListener("click", go);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    input?.addEventListener("input", () => { this.manualOverride = true; this.stopAutoFillPolling(); });
  }

  private async load(id: string): Promise<void> {
    this.currentId = id;
    const input = this.container.querySelector<HTMLInputElement>(".pwr-input");
    if (input) input.value = id;
    const body = this.container.querySelector<HTMLDivElement>(".pwr-body");
    if (!body) return;
    body.innerHTML = `<div class="pwr-loading">Loading diagnostics…</div>`;
    try {
      const events: DiagnosticsEvent[] = await getConversationDiagnostics(id);
      this.renderResult(body, explain(events));
    } catch (err) {
      body.innerHTML = `<div class="pwr-error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  private renderResult(body: HTMLDivElement, ex: Explanation): void {
    const metrics = ex.metrics.map((m) => `<div class="pwr-metric"><span class="pwr-metric-value">${escapeHtml(m.value)}</span><span class="pwr-metric-label">${escapeHtml(m.label)}</span></div>`).join("");
    const warnings = ex.warnings.map((w) => `<div class="pwr-warning">${escapeHtml(w)}</div>`).join("");
    const steps = ex.steps.map((s) => `
      <div class="pwr-step pwr-${s.status}">
        <div class="pwr-step-time">+${s.secondsFromStart}s</div>
        <div class="pwr-step-dot"></div>
        <div class="pwr-step-content">
          <div class="pwr-step-label">${escapeHtml(s.label)}</div>
          ${s.detail ? `<div class="pwr-step-detail">${escapeHtml(s.detail)}</div>` : ""}
          <button class="pwr-step-raw-toggle" type="button">Raw event</button>
          <pre class="pwr-step-raw" hidden>${escapeHtml(JSON.stringify(s.raw.customDimensions, null, 2))}</pre>
        </div>
      </div>`).join("");
    const narrative = ex.narrative.map((n) => `<p>${escapeHtml(n)}</p>`).join("");

    body.innerHTML = `
      ${metrics ? `<div class="pwr-metrics">${metrics}</div>` : ""}
      ${warnings}
      <h3 class="pwr-h">Why routing happened this way</h3>
      <div class="pwr-narrative">${narrative}</div>
      <h3 class="pwr-h">Timeline</h3>
      <div class="pwr-timeline">${steps}</div>`;

    body.querySelectorAll<HTMLButtonElement>(".pwr-step-raw-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pre = btn.nextElementSibling as HTMLElement;
        pre.hidden = !pre.hidden;
      });
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

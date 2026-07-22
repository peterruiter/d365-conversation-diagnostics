import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { getConversationDiagnostics, DiagnosticsEvent } from "./api";
import { explain, Explanation } from "./explainEngine";
import { extractConversationId, GUID_RE } from "./idParser";

/* Conversation Analyzer
   Hosts in three places with the same code:
   1. Custom page "Conversation Analyzer" (search box visible)
   2. Productivity pane tool in Customer Service workspace
   3. Opened directly with ?pwr_id=<guid> where the host allows it

   There is deliberately no session auto-detection: Microsoft documents that custom
   productivity tools have no supported access to session context, and the attempts
   that appeared to work were unreliable. Paste the id or the conversation URL.       */

export class ConversationAnalyzer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private currentId = "";

  public init(context: ComponentFramework.Context<IInputs>, _notify: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.container = container;
    this.container.classList.add("pwr-analyzer");
    this.renderShell();

    const bound = context.parameters.conversationId?.raw ?? "";
    const fromUrl = new URLSearchParams(window.location.search).get("pwr_id") ?? "";
    const resolved = bound || fromUrl;
    if (resolved) void this.load(resolved);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const bound = context.parameters.conversationId?.raw ?? "";
    if (bound && bound !== this.currentId) this.load(bound);
  }

  public getOutputs(): IOutputs { return {}; }
  public destroy(): void { /* nothing to clean up */ }

  private renderShell(): void {
    this.container.innerHTML = `
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
      this.load(id);
    };
    btn?.addEventListener("click", go);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });

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

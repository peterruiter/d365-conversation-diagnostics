import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { getConversationDiagnostics, DiagnosticsEvent } from "./api";
import { explain, Explanation } from "./explainEngine";

/* Conversation Analyzer
   Hosts in three places with the same code:
   1. Custom page "Conversation Analyzer" (search box visible)
   2. Productivity pane tool in Customer Service workspace (id auto-resolved from session)
   3. Deep link from the Routing Overview page (?crd_id=<guid>)                       */

export class ConversationAnalyzer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container: HTMLDivElement;
  private currentId = "";

  public init(context: ComponentFramework.Context<IInputs>, _notify: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.container = container;
    this.container.classList.add("crd-analyzer");
    this.renderShell();

    const bound = context.parameters.conversationId?.raw ?? "";
    const fromUrl = new URLSearchParams(window.location.search).get("crd_id") ?? "";
    const resolved = bound || fromUrl || this.resolveFromSession();
    if (resolved) this.load(resolved);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const bound = context.parameters.conversationId?.raw ?? "";
    if (bound && bound !== this.currentId) this.load(bound);
  }

  public getOutputs(): IOutputs { return {}; }
  public destroy(): void { /* nothing to clean up */ }

  /* Productivity pane: resolve the conversation from the active session tab. */
  private resolveFromSession(): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xrmApp = (window.parent as any).Xrm?.App;
      const sessionId = xrmApp?.sessions?.getFocusedSession?.()?.sessionId as string | undefined;
      if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) return sessionId;
    } catch { /* not in a session context */ }
    return "";
  }

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="crd-search">
        <input type="text" class="crd-input" placeholder="Conversation or work item id (GUID)" aria-label="Conversation id" />
        <button class="crd-btn" type="button">Analyze</button>
      </div>
      <div class="crd-body"><div class="crd-empty">Enter a conversation id to see its routing story.</div></div>`;
    const input = this.container.querySelector<HTMLInputElement>(".crd-input");
    const btn = this.container.querySelector<HTMLButtonElement>(".crd-btn");
    const go = () => { if (input?.value.trim()) this.load(input.value.trim()); };
    btn?.addEventListener("click", go);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  private async load(id: string): Promise<void> {
    this.currentId = id;
    const input = this.container.querySelector<HTMLInputElement>(".crd-input");
    if (input) input.value = id;
    const body = this.container.querySelector<HTMLDivElement>(".crd-body");
    if (!body) return;
    body.innerHTML = `<div class="crd-loading">Loading diagnostics…</div>`;
    try {
      const events: DiagnosticsEvent[] = await getConversationDiagnostics(id);
      this.renderResult(body, explain(events));
    } catch (err) {
      body.innerHTML = `<div class="crd-error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  private renderResult(body: HTMLDivElement, ex: Explanation): void {
    const metrics = ex.metrics.map((m) => `<div class="crd-metric"><span class="crd-metric-value">${escapeHtml(m.value)}</span><span class="crd-metric-label">${escapeHtml(m.label)}</span></div>`).join("");
    const warnings = ex.warnings.map((w) => `<div class="crd-warning">${escapeHtml(w)}</div>`).join("");
    const steps = ex.steps.map((s) => `
      <div class="crd-step crd-${s.status}">
        <div class="crd-step-time">+${s.secondsFromStart}s</div>
        <div class="crd-step-dot"></div>
        <div class="crd-step-content">
          <div class="crd-step-label">${escapeHtml(s.label)}</div>
          ${s.detail ? `<div class="crd-step-detail">${escapeHtml(s.detail)}</div>` : ""}
          <button class="crd-step-raw-toggle" type="button">Raw event</button>
          <pre class="crd-step-raw" hidden>${escapeHtml(JSON.stringify(s.raw.customDimensions, null, 2))}</pre>
        </div>
      </div>`).join("");
    const narrative = ex.narrative.map((n) => `<p>${escapeHtml(n)}</p>`).join("");

    body.innerHTML = `
      ${metrics ? `<div class="crd-metrics">${metrics}</div>` : ""}
      ${warnings}
      <h3 class="crd-h">Why routing happened this way</h3>
      <div class="crd-narrative">${narrative}</div>
      <h3 class="crd-h">Timeline</h3>
      <div class="crd-timeline">${steps}</div>`;

    body.querySelectorAll<HTMLButtonElement>(".crd-step-raw-toggle").forEach((btn) => {
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

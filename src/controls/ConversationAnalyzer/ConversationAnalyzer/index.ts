import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { getConversationDiagnostics, DiagnosticsEvent } from "./api";
import { explain, Explanation } from "./explainEngine";
import { extractConversationId, GUID_RE } from "./idParser";

/* Conversation Analyzer
   Hosts in three places with the same code:
   1. Custom page "Conversation Analyzer" (search box visible)
   2. Productivity pane tool in Customer Service workspace (best-effort session resolution)
   3. Deep link from the Routing Overview page (?pwr_id=<guid>)                        */

export class ConversationAnalyzer implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private currentId = "";

  public init(context: ComponentFramework.Context<IInputs>, _notify: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.container = container;
    this.container.classList.add("pwr-analyzer");
    this.renderShell();

    const bound = context.parameters.conversationId?.raw ?? "";
    const fromUrl = new URLSearchParams(window.location.search).get("pwr_id") ?? "";
    const resolved = bound || fromUrl || this.resolveFromSession();
    if (resolved) this.load(resolved);
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    const bound = context.parameters.conversationId?.raw ?? "";
    if (bound && bound !== this.currentId) this.load(bound);
  }

  public getOutputs(): IOutputs { return {}; }
  public destroy(): void { /* nothing to clean up */ }

  /* Best-effort resolution of the conversation id from the hosting session.
     Microsoft documents that custom productivity tools are not contextually bound to the
     session and have no supported mechanism to read session context, so none of this is
     guaranteed. It works often enough to be worth trying; the search box is the fallback.

     The pane may be iframed, so every candidate window is probed, not just window.parent.
     A session id is NOT a conversation id - only the session context carries the live
     work item, so sessionId is never used as an answer. */
  private resolveFromSession(): string {
    for (const win of this.candidateWindows()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = win as any;
        const session =
          w.Xrm?.App?.sessions?.getFocusedSession?.() ??
          w.Microsoft?.Apm?.getFocusedSession?.();
        if (!session) continue;

        const ctx = typeof session.getContext === "function" ? session.getContext() : null;
        if (!ctx) continue;

        const id = this.idFromSessionContext(ctx);
        if (id) return id;
      } catch { /* cross-origin or no session API on this window */ }
    }
    return "";
  }

  private candidateWindows(): Window[] {
    const list: Window[] = [];
    const push = (w: Window | null | undefined) => { if (w && !list.includes(w)) list.push(w); };
    push(window);
    push(window.parent);
    try { push(window.top); } catch { /* cross-origin top */ }
    try { push(window.parent?.parent); } catch { /* ignore */ }
    return list;
  }

  /* Session context shapes differ by channel and release, so check the documented
     spots and then sweep any nested value that looks like a live work item id. */
  private idFromSessionContext(ctx: Record<string, unknown>): string {
    const direct = [
      (ctx as Record<string, string>).liveWorkItemId,
      (ctx as Record<string, string>).LiveWorkItemId,
      (ctx as Record<string, string>).conversationId,
      ((ctx.templateParameters as Record<string, string>) ?? {}).liveWorkItemId,
      ((ctx.templateParameters as Record<string, string>) ?? {}).entityId,
      ((ctx.customerName as Record<string, string>) ?? {}).liveWorkItemId
    ];
    for (const c of direct) {
      const v = typeof c === "string" ? c.replace(/[{}]/g, "") : "";
      if (GUID_RE.test(v)) return v;
    }

    // Only trust entityId when the session is actually on a conversation record.
    const entityName = String((ctx as Record<string, string>).entityName ?? "").toLowerCase();
    if (entityName === "msdyn_ocliveworkitem") {
      const v = String((ctx as Record<string, string>).entityId ?? "").replace(/[{}]/g, "");
      if (GUID_RE.test(v)) return v;
    }

    // Last resort: any nested key that names a live work item.
    for (const [key, value] of Object.entries(ctx)) {
      if (!/liveworkitem|conversation/i.test(key)) continue;
      const v = typeof value === "string" ? value.replace(/[{}]/g, "") : "";
      if (GUID_RE.test(v)) return v;
    }
    return "";
  }

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="pwr-search">
        <input type="text" class="pwr-input" placeholder="Conversation id or pasted record URL" aria-label="Conversation id or record URL" />
        <button class="pwr-btn" type="button">Analyze</button>
        <button class="pwr-btn pwr-btn-secondary pwr-btn-session" type="button" title="Read the conversation from the session open on screen">Use current session</button>
      </div>
      <div class="pwr-body"><div class="pwr-empty">Paste a conversation or work item id to see its routing story.</div></div>`;
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

    this.container.querySelector<HTMLButtonElement>(".pwr-btn-session")?.addEventListener("click", () => {
      const id = this.resolveFromSession();
      const body = this.container.querySelector<HTMLDivElement>(".pwr-body");
      if (id) {
        this.load(id);
      } else if (body) {
        body.innerHTML = `<div class="pwr-warning">Could not read a conversation from the session on screen. ` +
          `Custom productivity tools have no supported access to session context, so this does not always work. ` +
          `Use the Copy link button on the conversation and paste the URL above.</div>`;
      }
    });

    // Re-resolve when the agent switches session tabs, where the platform allows it.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessions = (window.parent as any).Xrm?.App?.sessions;
      if (sessions?.addOnAfterSessionSwitch) {
        sessions.addOnAfterSessionSwitch(() => {
          const id = this.resolveFromSession();
          if (id && id !== this.currentId) this.load(id);
        });
      }
    } catch { /* not available in this host */ }
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

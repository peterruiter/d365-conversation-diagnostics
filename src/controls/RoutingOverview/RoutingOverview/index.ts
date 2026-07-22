import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { runNamedQuery, getConversationDiagnostics } from "./api";
import { explain, Explanation } from "./explainEngine";

/* Routing Overview
   Replica of the FastTrack "Unified Routing Diagnostics" dashboard page,
   rendered inside Dynamics. Select a work item row to cross-filter the
   classification, route-to-queue, assignment and timeline panels.
   Plus the seven "problem" tiles from the Conversation Diagnostics page. */

const DETAIL_TILES: { key: string; title: string }[] = [
  { key: "ClassificationDetails", title: "Classification details" },
  { key: "RouteToQueueDetails", title: "Route to queue details" },
  { key: "AgentAssignmentDetails", title: "Agent assignment details" },
  { key: "WorkItemTimeline", title: "Timeline" }
];

const PROBLEM_TILES: { key: string; title: string }[] = [
  { key: "ConversationStateFlow", title: "Conversation state flow" },
  { key: "FallbackQueueRouting", title: "Fallback queue routing" },
  { key: "OverflowTriggered", title: "Overflow triggered" },
  { key: "MultipleRejections", title: "Agents rejected multiple times" },
  { key: "SlowAssignment", title: "Assignment longer than 2 minutes" },
  { key: "LongHandleTime", title: "Handle time longer than 5 minutes" },
  { key: "TopRejectingAgents", title: "Top 20 agents by reject count" }
];

export class RoutingOverview implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private container!: HTMLDivElement;
  private hours = 6;
  private selectedWorkItem = "";


  public init(_context: ComponentFramework.Context<IInputs>, _notify: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.container = container;
    this.container.classList.add("pwr-overview");
    this.renderShell();
    void this.loadIncoming();
  }

  public updateView(): void { /* stateless against context */ }
  public getOutputs(): IOutputs { return {}; }
  public destroy(): void { /* nothing to clean up */ }

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="pwr-toolbar">
        <label>Time range
          <select class="pwr-range">
            <option value="1">Last hour</option>
            <option value="6" selected>Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
          </select>
        </label>
        <button class="pwr-refresh" type="button">Refresh</button>
      </div>
      <div class="pwr-panel">
        <h3>Incoming work items</h3>
        <div class="pwr-grid" data-tile="incoming"><div class="pwr-loading">Loading…</div></div>
      </div>
      <div class="pwr-detail-panels">
        ${DETAIL_TILES.map((t) => `
          <div class="pwr-panel">
            <h3>${t.title} <span class="pwr-selected-id"></span>
              ${t.key === "WorkItemTimeline" ? `<button class="pwr-analyze-btn" type="button" hidden>Explain this routing</button>` : ""}
            </h3>
            <div class="pwr-grid" data-tile="${t.key}"><div class="pwr-empty">Select a work item above.</div></div>
          </div>`).join("")}
      </div>
      <div class="pwr-panel pwr-analysis-panel" hidden>
        <h3>Routing explanation <span class="pwr-selected-id"></span></h3>
        <div class="pwr-analysis-body"></div>
      </div>
      <h2 class="pwr-section">Problem spotlights</h2>
      ${PROBLEM_TILES.map((t) => `
        <details class="pwr-panel pwr-collapsible" data-key="${t.key}">
          <summary>${t.title}</summary>
          <div class="pwr-grid" data-tile="${t.key}"><div class="pwr-empty">Expand to load.</div></div>
        </details>`).join("")}`;

    this.container.querySelector<HTMLSelectElement>(".pwr-range")?.addEventListener("change", (e) => {
      this.hours = parseInt((e.target as HTMLSelectElement).value, 10);
      void this.loadIncoming();
    });
    this.container.querySelector<HTMLButtonElement>(".pwr-refresh")?.addEventListener("click", () => void this.loadIncoming());
    this.container.querySelector<HTMLButtonElement>(".pwr-analyze-btn")?.addEventListener("click", () => {
      if (this.selectedWorkItem) void this.renderAnalysis(this.selectedWorkItem);
    });
    this.container.querySelectorAll<HTMLDetailsElement>(".pwr-collapsible").forEach((d) => {
      d.addEventListener("toggle", () => {
        if (d.open) void this.loadTile(d.dataset.key as string, d.querySelector(".pwr-grid") as HTMLElement);
      });
    });
  }

  private async loadIncoming(): Promise<void> {
    const grid = this.container.querySelector<HTMLElement>('[data-tile="incoming"]');
    if (!grid) return;
    grid.innerHTML = `<div class="pwr-loading">Loading…</div>`;
    try {
      const rows = await runNamedQuery("IncomingWorkItems", this.hours);
      this.renderTable(grid, rows, true);
    } catch (err) {
      grid.innerHTML = `<div class="pwr-error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  private async loadTile(key: string, grid: HTMLElement, workItemId?: string): Promise<void> {
    grid.innerHTML = `<div class="pwr-loading">Loading…</div>`;
    try {
      const rows = await runNamedQuery(key, this.hours, workItemId);
      this.renderTable(grid, rows, false);
    } catch (err) {
      grid.innerHTML = `<div class="pwr-error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  private selectWorkItem(id: string): void {
    this.selectedWorkItem = id;
    this.container.querySelectorAll<HTMLElement>(".pwr-selected-id").forEach((el) => (el.textContent = `· ${id}`));
    const analyzeBtn = this.container.querySelector<HTMLButtonElement>(".pwr-analyze-btn");
    if (analyzeBtn) analyzeBtn.hidden = false;
    // Collapse any previous explanation; it belongs to the previously selected row.
    const panel = this.container.querySelector<HTMLElement>(".pwr-analysis-panel");
    if (panel) panel.hidden = true;

    for (const t of DETAIL_TILES) {
      const grid = this.container.querySelector<HTMLElement>(`[data-tile="${t.key}"]`);
      if (grid) void this.loadTile(t.key, grid, id);
    }
  }

  /* Full routing explanation for the selected work item, rendered in place.
     Deliberately not a navigation to the analyzer custom page: custom pages reject
     arbitrary query string parameters, so a deep link carrying the id fails. */
  private async renderAnalysis(workItemId: string): Promise<void> {
    const panel = this.container.querySelector<HTMLElement>(".pwr-analysis-panel");
    const body = this.container.querySelector<HTMLElement>(".pwr-analysis-body");
    if (!panel || !body) return;

    panel.hidden = false;
    body.innerHTML = `<div class="pwr-loading">Building explanation...</div>`;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    try {
      const events = await getConversationDiagnostics(workItemId);
      this.paintExplanation(body, explain(events));
    } catch (err) {
      body.innerHTML = `<div class="pwr-error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  private paintExplanation(body: HTMLElement, ex: Explanation): void {
    const metrics = ex.metrics.map((m) =>
      `<div class="pwr-metric"><span class="pwr-metric-value">${escapeHtml(m.value)}</span><span class="pwr-metric-label">${escapeHtml(m.label)}</span></div>`).join("");
    const warnings = ex.warnings.map((w) => `<div class="pwr-warning">${escapeHtml(w)}</div>`).join("");
    const narrative = ex.narrative.map((n) => `<p>${escapeHtml(n)}</p>`).join("");
    const steps = ex.steps.map((st) => `
      <div class="pwr-step pwr-${st.status}">
        <div class="pwr-step-time">+${st.secondsFromStart}s</div>
        <div class="pwr-step-dot"></div>
        <div class="pwr-step-content">
          <div class="pwr-step-label">${escapeHtml(st.label)}</div>
          ${st.detail ? `<div class="pwr-step-detail">${escapeHtml(st.detail)}</div>` : ""}
        </div>
      </div>`).join("");

    body.innerHTML = `
      ${metrics ? `<div class="pwr-metrics">${metrics}</div>` : ""}
      ${warnings}
      <div class="pwr-narrative">${narrative}</div>
      <div class="pwr-timeline">${steps}</div>`;
  }

  private renderTable(grid: HTMLElement, rows: Record<string, unknown>[], selectable: boolean): void {
    if (rows.length === 0) { grid.innerHTML = `<div class="pwr-empty">No rows in this time range.</div>`; return; }
    const cols = Object.keys(rows[0]);
    const thead = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
    const tbody = rows.map((r) => {
      const id = String(r["workItem"] ?? r["conversationId"] ?? "");
      return `<tr ${selectable && id ? `class="pwr-row-select" data-id="${escapeHtml(id)}"` : ""}>` +
        cols.map((c) => `<td title="${escapeHtml(String(r[c] ?? ""))}">${escapeHtml(truncate(String(r[c] ?? ""), 120))}</td>`).join("") + `</tr>`;
    }).join("");
    grid.innerHTML = `<div class="pwr-table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
    const wrap = grid.querySelector<HTMLElement>(".pwr-table-wrap");
    if (wrap && wrap.scrollWidth > wrap.clientWidth) {
      const hint = document.createElement("div");
      hint.className = "pwr-scroll-hint";
      hint.textContent = `${cols.length} columns — scroll sideways to see them all.`;
      grid.insertBefore(hint, wrap);
    }
    grid.querySelectorAll<HTMLTableRowElement>(".pwr-row-select").forEach((tr) => {
      tr.addEventListener("click", () => {
        grid.querySelectorAll(".pwr-row-active").forEach((x) => x.classList.remove("pwr-row-active"));
        tr.classList.add("pwr-row-active");
        this.selectWorkItem(tr.dataset.id as string);
      });
    });
  }
}

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + "…" : s; }
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { runNamedQuery } from "./api";

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
  private container: HTMLDivElement;
  private hours = 6;
  private selectedWorkItem = "";

  public init(_context: ComponentFramework.Context<IInputs>, _notify: () => void, _state: ComponentFramework.Dictionary, container: HTMLDivElement): void {
    this.container = container;
    this.container.classList.add("crd-overview");
    this.renderShell();
    void this.loadIncoming();
  }

  public updateView(): void { /* stateless against context */ }
  public getOutputs(): IOutputs { return {}; }
  public destroy(): void { /* nothing to clean up */ }

  private renderShell(): void {
    this.container.innerHTML = `
      <div class="crd-toolbar">
        <label>Time range
          <select class="crd-range">
            <option value="1">Last hour</option>
            <option value="6" selected>Last 6 hours</option>
            <option value="24">Last 24 hours</option>
            <option value="168">Last 7 days</option>
          </select>
        </label>
        <button class="crd-refresh" type="button">Refresh</button>
      </div>
      <div class="crd-panel">
        <h3>Incoming work items</h3>
        <div class="crd-grid" data-tile="incoming"><div class="crd-loading">Loading…</div></div>
      </div>
      <div class="crd-detail-panels">
        ${DETAIL_TILES.map((t) => `
          <div class="crd-panel">
            <h3>${t.title} <span class="crd-selected-id"></span>
              ${t.key === "WorkItemTimeline" ? `<a class="crd-analyzer-link" hidden>Open in Conversation Analyzer</a>` : ""}
            </h3>
            <div class="crd-grid" data-tile="${t.key}"><div class="crd-empty">Select a work item above.</div></div>
          </div>`).join("")}
      </div>
      <h2 class="crd-section">Problem spotlights</h2>
      ${PROBLEM_TILES.map((t) => `
        <details class="crd-panel crd-collapsible" data-key="${t.key}">
          <summary>${t.title}</summary>
          <div class="crd-grid" data-tile="${t.key}"><div class="crd-empty">Expand to load.</div></div>
        </details>`).join("")}`;

    this.container.querySelector<HTMLSelectElement>(".crd-range")?.addEventListener("change", (e) => {
      this.hours = parseInt((e.target as HTMLSelectElement).value, 10);
      void this.loadIncoming();
    });
    this.container.querySelector<HTMLButtonElement>(".crd-refresh")?.addEventListener("click", () => void this.loadIncoming());
    this.container.querySelectorAll<HTMLDetailsElement>(".crd-collapsible").forEach((d) => {
      d.addEventListener("toggle", () => {
        if (d.open) void this.loadTile(d.dataset.key as string, d.querySelector(".crd-grid") as HTMLElement);
      });
    });
  }

  private async loadIncoming(): Promise<void> {
    const grid = this.container.querySelector<HTMLElement>('[data-tile="incoming"]');
    if (!grid) return;
    grid.innerHTML = `<div class="crd-loading">Loading…</div>`;
    try {
      const rows = await runNamedQuery("IncomingWorkItems", this.hours);
      this.renderTable(grid, rows, true);
    } catch (err) {
      grid.innerHTML = `<div class="crd-error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  private async loadTile(key: string, grid: HTMLElement, workItemId?: string): Promise<void> {
    grid.innerHTML = `<div class="crd-loading">Loading…</div>`;
    try {
      const rows = await runNamedQuery(key, this.hours, workItemId);
      this.renderTable(grid, rows, false);
    } catch (err) {
      grid.innerHTML = `<div class="crd-error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  private selectWorkItem(id: string): void {
    this.selectedWorkItem = id;
    this.container.querySelectorAll<HTMLElement>(".crd-selected-id").forEach((el) => (el.textContent = `· ${id}`));
    const link = this.container.querySelector<HTMLAnchorElement>(".crd-analyzer-link");
    if (link) {
      link.hidden = false;
      link.href = `?pagetype=custom&name=crd_conversationanalyzer_page&crd_id=${encodeURIComponent(id)}`;
    }
    for (const t of DETAIL_TILES) {
      const grid = this.container.querySelector<HTMLElement>(`[data-tile="${t.key}"]`);
      if (grid) void this.loadTile(t.key, grid, id);
    }
  }

  private renderTable(grid: HTMLElement, rows: Record<string, unknown>[], selectable: boolean): void {
    if (rows.length === 0) { grid.innerHTML = `<div class="crd-empty">No rows in this time range.</div>`; return; }
    const cols = Object.keys(rows[0]);
    const thead = `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
    const tbody = rows.map((r) => {
      const id = String(r["workItem"] ?? r["conversationId"] ?? "");
      return `<tr ${selectable && id ? `class="crd-row-select" data-id="${escapeHtml(id)}"` : ""}>` +
        cols.map((c) => `<td title="${escapeHtml(String(r[c] ?? ""))}">${escapeHtml(truncate(String(r[c] ?? ""), 120))}</td>`).join("") + `</tr>`;
    }).join("");
    grid.innerHTML = `<div class="crd-table-wrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
    grid.querySelectorAll<HTMLTableRowElement>(".crd-row-select").forEach((tr) => {
      tr.addEventListener("click", () => {
        grid.querySelectorAll(".crd-row-active").forEach((x) => x.classList.remove("crd-row-active"));
        tr.classList.add("crd-row-active");
        this.selectWorkItem(tr.dataset.id as string);
      });
    });
  }
}

function truncate(s: string, n: number): string { return s.length > n ? s.slice(0, n) + "…" : s; }
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

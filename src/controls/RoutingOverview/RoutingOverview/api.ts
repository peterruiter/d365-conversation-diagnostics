/* Thin wrapper around the pwr_* Custom APIs. Parses the Azure query API
   tables/rows payload into arrays of plain objects. */

export interface DiagnosticsEvent {
  timestamp: string;
  message: string;
  subscenario: string;
  customDimensions: Record<string, unknown>;
}

interface QueryApiResponse {
  tables: { name: string; columns: { name: string }[]; rows: unknown[][] }[];
}

function rowsToObjects(json: string): Record<string, unknown>[] {
  const parsed = JSON.parse(json) as QueryApiResponse;
  const table = parsed.tables && parsed.tables[0];
  if (!table) return [];
  return table.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    table.columns.forEach((c, i) => (obj[c.name] = row[i]));
    return obj;
  });
}

function execute(apiName: string, parameters: Record<string, { typeName: string; value: unknown }>): Promise<Record<string, string>> {
  const request: Record<string, unknown> = {
    getMetadata: () => ({
      boundParameter: null,
      operationType: 0,
      operationName: apiName,
      parameterTypes: Object.fromEntries(
        Object.entries(parameters).map(([k, v]) => [k, { typeName: v.typeName, structuralProperty: 1 }])
      )
    })
  };
  Object.entries(parameters).forEach(([k, v]) => (request[k] = v.value));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webApi = (window.parent as any).Xrm?.WebApi ?? (window as any).Xrm?.WebApi;
  return webApi.execute(request).then(async (r: Response) => {
    if (!r.ok) throw new Error(`${apiName} failed (${r.status})`);
    return r.json();
  });
}

export async function getConversationDiagnostics(conversationId: string, hours = 720): Promise<DiagnosticsEvent[]> {
  const result = await execute("pwr_GetConversationDiagnostics", {
    ConversationId: { typeName: "Edm.String", value: conversationId },
    TimeRangeHours: { typeName: "Edm.Int32", value: hours }
  });
  const rows = rowsToObjects(result.EventsJson);
  return rows.map((r) => ({
    timestamp: String(r.timestamp ?? ""),
    message: String(r.message ?? ""),
    subscenario: String(r.subscenario ?? ""),
    customDimensions: safeParse(String(r.customDimensions ?? "{}"))
  }));
}

export async function runNamedQuery(queryKey: string, hours: number, workItemId?: string): Promise<Record<string, unknown>[]> {
  const params: Record<string, { typeName: string; value: unknown }> = {
    QueryKey: { typeName: "Edm.String", value: queryKey },
    TimeRangeHours: { typeName: "Edm.Int32", value: hours }
  };
  if (workItemId) params.WorkItemId = { typeName: "Edm.String", value: workItemId };
  const result = await execute("pwr_ExecuteDiagnosticsQuery", params);
  return rowsToObjects(result.ResultJson);
}

function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

/** Reads a single environment variable value (current value, else default). */
export async function getEnvironmentVariable(schemaName: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webApi = (window.parent as any).Xrm?.WebApi ?? (window as any).Xrm?.WebApi;
  if (!webApi) return "";
  try {
    const result = await webApi.retrieveMultipleRecords(
      "environmentvariabledefinition",
      `?$select=defaultvalue&$filter=schemaname eq '${schemaName}'` +
      `&$expand=environmentvariabledefinition_environmentvariablevalue($select=value)`
    );
    const def = result.entities?.[0];
    if (!def) return "";
    const current = def.environmentvariabledefinition_environmentvariablevalue?.[0]?.value as string | undefined;
    return (current && current.trim()) || (def.defaultvalue as string) || "";
  } catch {
    return "";
  }
}

/** Current model-driven app id, needed to build a custom page URL. */
export function getAppId(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xrm = (window.parent as any).Xrm ?? (window as any).Xrm;
    const fromApi = xrm?.Utility?.getGlobalContext?.()?.getCurrentAppProperties?.();
    if (fromApi && typeof fromApi.then !== "function" && fromApi.appId) return String(fromApi.appId);
  } catch { /* fall through to the URL */ }
  const fromUrl = new URLSearchParams(window.location.search).get("appid");
  return fromUrl ?? "";
}

/** Environment variable holding the Conversation Analyzer custom page's logical name.
    Custom pages get a random suffix appended by the maker portal, so the logical name
    is environment-specific and cannot be hardcoded - see docs/setup-app-profile.md. */
const ANALYZER_PAGE_NAME_VAR = "pwr_ConversationAnalyzerPageName";

/** Opens the Conversation Analyzer custom page for a work item using the officially
    supported Xrm.Navigation.navigateTo custom-page mechanism (pageInput recordId /
    entityName, read on the page via Param("recordId") / Param("entityName")).
    This is deliberately not a query-string deep link: custom pages only expose
    Param()-recognized inputs, not arbitrary query parameters (see README Known limits).
    Throws instead of swallowing failures so the caller can surface them in the UI. */
export async function openConversationAnalyzerPage(workItemId: string): Promise<void> {
  const pageName = await getEnvironmentVariable(ANALYZER_PAGE_NAME_VAR);
  if (!pageName) {
    throw new Error(`Set the ${ANALYZER_PAGE_NAME_VAR} environment variable to your Conversation Analyzer custom page's logical name first (docs/setup-app-profile.md).`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = (window.parent as any).Xrm?.Navigation ?? (window as any).Xrm?.Navigation;
  if (!navigation?.navigateTo) throw new Error("Xrm.Navigation.navigateTo is not available in this host.");
  await navigation.navigateTo(
    { pageType: "custom", name: pageName, entityName: "msdyn_ocliveworkitem", recordId: workItemId },
    { target: 2, position: 1, width: { value: 720, unit: "px" }, title: "Conversation Analyzer" }
  );
}


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

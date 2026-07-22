/* Conversation id parsing, kept out of index.ts because a PCF control file
   must have exactly one export (the control class). */

export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Accepts a bare GUID, a braced GUID, or a full record URL copied with the
 * "Copy link" button, and returns the conversation id.
 * Record URLs carry several GUIDs (appid as well as the record id), so named
 * parameters win and appid is excluded before falling back to a scan.
 */
export function extractConversationId(input: string): string {
  const raw = (input ?? "").trim().replace(/[{}]/g, "");
  if (!raw) return "";
  if (GUID_RE.test(raw)) return raw;

  let search: string;
  try {
    search = new URL(raw).search;
  } catch {
    const q = raw.indexOf("?");
    search = q >= 0 ? raw.slice(q) : "";
  }

  if (search) {
    const params = new URLSearchParams(search);
    for (const key of ["pwr_id", "id", "recordId", "conversationid"]) {
      const v = (params.get(key) ?? "").replace(/[{}]/g, "");
      if (GUID_RE.test(v)) return v;
    }
    const appId = (params.get("appid") ?? "").toLowerCase();
    for (const m of raw.match(GUID_ANYWHERE) ?? []) {
      if (m.toLowerCase() !== appId) return m;
    }
    return "";
  }

  const found = raw.match(GUID_ANYWHERE);
  return found && found.length > 0 ? found[0] : "";
}

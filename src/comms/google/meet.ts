import type { InboxItem } from "../types.ts";
import { getAccessToken, hasGoogleAuth } from "./auth.ts";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink?: string;
}

export async function fetchMeetTranscripts(account: string): Promise<InboxItem[]> {
  if (!hasGoogleAuth()) return [];
  try {
    const token = await getAccessToken(DRIVE_SCOPES, account);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const q = encodeURIComponent(
      `(name contains 'Meet' or name contains 'transcript') and mimeType='application/vnd.google-apps.document' and modifiedTime > '${since}' and trashed=false`,
    );
    const res = await fetch(
      `${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime,webViewLink)&pageSize=5`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: DriveFile[] };
    return (data.files ?? []).map(
      (f): InboxItem => ({
        channel: "google-calendar",
        externalId: `meet-${f.id}`,
        from: "Google Meet",
        subject: f.name,
        preview: `Meeting transcript available.${f.webViewLink ? ` View: ${f.webViewLink}` : ""}`,
        receivedAt: f.modifiedTime,
        status: "unread",
        priority: "normal",
        metadata: { type: "meet-transcript", driveId: f.id, webViewLink: f.webViewLink },
      }),
    );
  } catch (err) {
    logger.warn("comms:meet-transcripts", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

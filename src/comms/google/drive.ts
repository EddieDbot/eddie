import { getAccessToken, hasGoogleAuth } from "./auth.ts";
import { config } from "../../config.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  size?: string;
}

function getPrimaryAccount(): string | null {
  const accounts = (config.COMMS_EMAIL_ACCOUNTS ?? "").split(",").map((a) => a.trim()).filter(Boolean);
  return accounts.find((a) => !a.toLowerCase().includes("eddie")) ?? accounts[0] ?? null;
}

export async function searchDrive(query: string, account?: string): Promise<DriveFile[]> {
  if (!hasGoogleAuth()) throw new Error("Google auth not configured");
  const subject = account ?? getPrimaryAccount();
  if (!subject) throw new Error("No Google account configured");

  const token = await getAccessToken(DRIVE_SCOPES, subject);
  const q = encodeURIComponent(`fullText contains '${query.replace(/'/g, "\\'")}' and trashed=false`);
  const res = await fetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&pageSize=10`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`Drive search failed: ${res.status}`);
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function getDriveFileContent(fileId: string, account?: string): Promise<string> {
  if (!hasGoogleAuth()) throw new Error("Google auth not configured");
  const subject = account ?? getPrimaryAccount();
  if (!subject) throw new Error("No Google account configured");

  const token = await getAccessToken(DRIVE_SCOPES, subject);

  // Try export first (Google Docs → plain text)
  const exportRes = await fetch(`${DRIVE_API}/files/${fileId}/export?mimeType=text/plain`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (exportRes.ok) return exportRes.text();

  // Fall back to direct media download
  const mediaRes = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!mediaRes.ok) throw new Error(`Drive read failed: ${mediaRes.status}`);
  return mediaRes.text();
}

export async function formatDriveResults(files: DriveFile[]): Promise<string> {
  if (files.length === 0) return "No files found.";
  return files
    .map((f) => {
      const modified = new Date(f.modifiedTime).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const link = f.webViewLink ? `\n  ${f.webViewLink}` : "";
      return `• ${f.name} (${f.mimeType.split(".").pop()}, ${modified})${link}`;
    })
    .join("\n");
}

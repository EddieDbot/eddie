import type { ChannelProvider, ChannelStatus, InboxItem } from "../types.ts";
import { getAccessToken, hasGoogleAuth } from "./auth.ts";
import { getSyncState, setSyncState, getUnreadCount } from "../inbox.ts";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const GMAIL_SCOPES = "https://www.googleapis.com/auth/gmail.modify";
const POLL_INTERVAL_MS = 60_000;

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: {
    headers?: { name: string; value: string }[];
    body?: { data?: string };
    parts?: GmailPart[];
  };
}

interface GmailPart {
  mimeType: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function getHeader(msg: GmailMessage, name: string): string {
  return (
    msg.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

function decodeB64(encoded: string): string {
  try {
    return atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
}

function extractBody(msg: GmailMessage): string {
  const findText = (parts?: GmailPart[]): string => {
    if (!parts) return "";
    for (const part of parts) {
      if (part.mimeType === "text/plain" && part.body?.data)
        return decodeB64(part.body.data).slice(0, 500);
      const nested = findText(part.parts);
      if (nested) return nested;
    }
    return "";
  };
  if (msg.payload?.body?.data)
    return decodeB64(msg.payload.body.data).slice(0, 500);
  return findText(msg.payload?.parts);
}

function messageToItem(
  msg: GmailMessage,
  channel: "gmail" | "gmail-eddie",
): InboxItem {
  const from = getHeader(msg, "from");
  const subject = getHeader(msg, "subject");
  const isImportant = (msg.labelIds ?? []).some((l) =>
    ["IMPORTANT", "STARRED"].includes(l),
  );
  const body = extractBody(msg);
  return {
    channel,
    externalId: msg.id,
    from,
    subject: subject || undefined,
    preview: (msg.snippet ?? body).slice(0, 200),
    body: body || undefined,
    receivedAt: msg.internalDate
      ? new Date(parseInt(msg.internalDate)).toISOString()
      : new Date().toISOString(),
    status: "unread",
    priority: isImportant ? "high" : "normal",
    metadata: { threadId: msg.threadId },
  };
}

async function fetchGmailMessages(
  account: string,
  channel: "gmail" | "gmail-eddie",
): Promise<InboxItem[]> {
  const token = await getAccessToken(GMAIL_SCOPES, account);
  const sinceStr = await getSyncState(channel);
  const sinceTs = sinceStr
    ? parseInt(sinceStr)
    : Date.now() - 24 * 60 * 60 * 1000;

  const q = `is:unread after:${Math.floor(sinceTs / 1000)}`;
  const listRes = await fetch(
    `${GMAIL_API}/users/me/messages?q=${encodeURIComponent(q)}&maxResults=20`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!listRes.ok) throw new Error(`Gmail list ${listRes.status}`);
  const listData = (await listRes.json()) as { messages?: { id: string }[] };
  const ids = listData.messages ?? [];

  await setSyncState(channel, String(Date.now()));
  if (ids.length === 0) return [];

  const items: InboxItem[] = [];
  for (const { id } of ids.slice(0, 10)) {
    try {
      const msgRes = await fetch(
        `${GMAIL_API}/users/me/messages/${id}?format=full`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!msgRes.ok) continue;
      items.push(messageToItem((await msgRes.json()) as GmailMessage, channel));
    } catch {
      // skip individual failures
    }
  }
  return items;
}

function makeGmailProvider(
  account: string,
  channel: "gmail" | "gmail-eddie",
): ChannelProvider {
  let lastError: string | undefined;
  let lastPolledAt: string | undefined;

  return {
    id: channel,
    pollIntervalMs: POLL_INTERVAL_MS,
    async poll() {
      const items = await fetchGmailMessages(account, channel);
      lastPolledAt = new Date().toISOString();
      lastError = undefined;
      return items;
    },
    async healthCheck() {
      try {
        const token = await getAccessToken(GMAIL_SCOPES, account);
        const res = await fetch(`${GMAIL_API}/users/me/profile`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    async getStatus(): Promise<ChannelStatus> {
      const counts = await getUnreadCount();
      return {
        channel,
        enabled: true,
        healthy: !lastError,
        lastPolledAt,
        lastError,
        itemCount: counts[channel] ?? 0,
      };
    },
  };
}

export function createGmailProviders(): ChannelProvider[] {
  if (!hasGoogleAuth()) return [];
  const accounts = (config.COMMS_EMAIL_ACCOUNTS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  return accounts.map((account) => {
    const channel: "gmail" | "gmail-eddie" = account
      .toLowerCase()
      .includes("eddie")
      ? "gmail-eddie"
      : "gmail";
    logger.info("comms:gmail-provider", { account, channel });
    return makeGmailProvider(account, channel);
  });
}

import type { ChannelProvider, ChannelStatus, InboxItem } from "../types.ts";
import { getSyncState, setSyncState, getUnreadCount } from "../inbox.ts";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

const POLL_INTERVAL_MS = 30_000;

interface RelayMessage {
  id: string;
  text: string;
  from: string;
  chatId: string;
  receivedAt: string;
  isFromMe: boolean;
}

async function fetchFromRelay(since: number): Promise<RelayMessage[]> {
  const baseUrl = config.COMMS_IMESSAGE_RELAY_URL!;
  const headers: Record<string, string> = {};
  if (config.COMMS_IMESSAGE_RELAY_KEY) headers["x-api-key"] = config.COMMS_IMESSAGE_RELAY_KEY;

  const res = await fetch(`${baseUrl}/messages?since=${since}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`iMessage relay error: ${res.status}`);
  const data = (await res.json()) as { messages: RelayMessage[] };
  return data.messages ?? [];
}

export function createIMessageProvider(): ChannelProvider | null {
  if (!config.COMMS_IMESSAGE_RELAY_URL) return null;

  let lastError: string | undefined;
  let lastPolledAt: string | undefined;

  logger.info("comms:imessage-provider", { url: config.COMMS_IMESSAGE_RELAY_URL });
  return {
    id: "imessage",
    pollIntervalMs: POLL_INTERVAL_MS,
    async poll() {
      const cursor = await getSyncState("imessage");
      const since = cursor ? parseInt(cursor) : Date.now() - 3_600_000;
      const messages = await fetchFromRelay(since);

      lastPolledAt = new Date().toISOString();
      lastError = undefined;
      await setSyncState("imessage", String(Date.now()));

      return messages
        .filter((m) => !m.isFromMe)
        .map((m): InboxItem => ({
          channel: "imessage",
          externalId: m.id,
          from: m.from,
          preview: m.text.slice(0, 200),
          receivedAt: m.receivedAt,
          status: "unread",
          priority: "normal",
          metadata: { chatId: m.chatId },
        }));
    },
    async healthCheck() {
      const baseUrl = config.COMMS_IMESSAGE_RELAY_URL!;
      try {
        const headers: Record<string, string> = {};
        if (config.COMMS_IMESSAGE_RELAY_KEY) headers["x-api-key"] = config.COMMS_IMESSAGE_RELAY_KEY;
        const res = await fetch(`${baseUrl}/health`, { headers, signal: AbortSignal.timeout(5_000) });
        return res.ok;
      } catch {
        return false;
      }
    },
    async getStatus(): Promise<ChannelStatus> {
      const counts = await getUnreadCount();
      return {
        channel: "imessage",
        enabled: true,
        healthy: !lastError,
        lastPolledAt,
        lastError,
        itemCount: counts.imessage ?? 0,
      };
    },
  };
}

import type { ChannelProvider, ChannelStatus, InboxItem } from "../types.ts";
import { getUnreadCount } from "../inbox.ts";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

/**
 * WhatsApp read-only bridge client.
 *
 * Requires an external bridge running and exposed via COMMS_WHATSAPP_BRIDGE_URL.
 * Options:
 *   - go-whatsapp / whatsmeow HTTP wrapper
 *   - Meta Cloud API (requires business verification)
 *   - whatsapp-web.js REST wrapper
 *
 * Bridge must expose:
 *   GET /messages?since=<unix_ms>  → { messages: [{ id, from, body, timestamp, chatId }] }
 *   GET /health                    → { ok: true }
 */

const POLL_INTERVAL_MS = 60_000;

interface WAMessage {
  id: string;
  from: string;
  body: string;
  timestamp: number; // unix seconds
  chatId: string;
}

export function createWhatsAppProvider(): ChannelProvider | null {
  const bridgeUrl = config.COMMS_WHATSAPP_BRIDGE_URL;
  if (!bridgeUrl) return null;

  let lastError: string | undefined;
  let lastPolledAt: string | undefined;
  let since = Date.now() - 3_600_000;

  logger.info("comms:whatsapp-provider", { url: bridgeUrl });
  return {
    id: "whatsapp",
    pollIntervalMs: POLL_INTERVAL_MS,
    async poll() {
      const headers: Record<string, string> = {};
      if (config.COMMS_WHATSAPP_TOKEN) headers["Authorization"] = `Bearer ${config.COMMS_WHATSAPP_TOKEN}`;

      const res = await fetch(`${bridgeUrl}/messages?since=${since}`, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`WhatsApp bridge error: ${res.status}`);
      const data = (await res.json()) as { messages?: WAMessage[] };

      lastPolledAt = new Date().toISOString();
      lastError = undefined;
      since = Date.now();

      return (data.messages ?? []).map((m): InboxItem => ({
        channel: "whatsapp",
        externalId: m.id,
        from: m.from,
        preview: m.body.slice(0, 200),
        receivedAt: new Date(m.timestamp * 1000).toISOString(),
        status: "unread",
        priority: "normal",
        metadata: { chatId: m.chatId },
      }));
    },
    async healthCheck() {
      try {
        const res = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(5_000) });
        return res.ok;
      } catch {
        return false;
      }
    },
    async getStatus(): Promise<ChannelStatus> {
      const counts = await getUnreadCount();
      return {
        channel: "whatsapp",
        enabled: true,
        healthy: !lastError,
        lastPolledAt,
        lastError,
        itemCount: counts.whatsapp ?? 0,
      };
    },
  };
}

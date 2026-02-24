import type { Bot } from "gramio";
import type { InboxItem, ChannelId } from "./types.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";

const BATCH_DEBOUNCE_MS = 8_000;
const MAX_BATCH_SIZE = 10;

const CHANNEL_LABELS: Record<ChannelId, string> = {
  gmail: "📧 Gmail",
  "gmail-eddie": "📧 EDDIE Mail",
  "google-calendar": "📅 Calendar",
  "icloud-calendar": "📅 iCloud Cal",
  imessage: "💬 iMessage",
  slack: "💬 Slack",
  whatsapp: "💬 WhatsApp",
};

let pendingItems: InboxItem[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let botRef: Bot | null = null;

export function initNotifier(bot: Bot): void {
  botRef = bot;
}

export function queueNotification(items: InboxItem[]): void {
  if (!config.COMMS_NOTIFY_ENABLED) return;
  const ownerSlackId = config.SLACK_OWNER_USER_ID;
  const filtered = items.filter((item) => {
    if (item.channel === "gmail") {
      // Only ping for urgent emails
      const text = (item.subject + " " + item.preview).toLowerCase();
      return /urgent|asap|important|action required|immediate|critical/i.test(
        text,
      );
    }
    if (item.channel === "slack") {
      // Only ping for DMs or direct @mentions
      const isDm = (
        item.metadata as Record<string, string> | undefined
      )?.channelId?.startsWith("D");
      const isMentioned =
        ownerSlackId && item.preview.includes(`<@${ownerSlackId}>`);
      return isDm || !!isMentioned;
    }
    if (item.channel === "imessage") return false;
    return true;
  });
  if (filtered.length === 0) return;
  pendingItems.push(...filtered);
  if (pendingItems.length >= MAX_BATCH_SIZE) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    void flush();
    return;
  }
  if (!debounceTimer) {
    debounceTimer = setTimeout(() => void flush(), BATCH_DEBOUNCE_MS);
  }
}

async function flush(): Promise<void> {
  debounceTimer = null;
  const items = pendingItems.splice(0);
  if (items.length === 0 || !botRef) return;

  const byChannel = new Map<ChannelId, InboxItem[]>();
  for (const item of items) {
    if (!byChannel.has(item.channel)) byChannel.set(item.channel, []);
    byChannel.get(item.channel)!.push(item);
  }

  const sections: string[] = [];
  for (const [channel, channelItems] of byChannel) {
    const label = CHANNEL_LABELS[channel] ?? channel;
    const lines = channelItems.slice(0, 5).map((item) => {
      const from =
        item.from.length > 40 ? item.from.slice(0, 40) + "…" : item.from;
      const subj = item.subject ? ` — ${item.subject.slice(0, 60)}` : "";
      const preview = item.preview.slice(0, 100);
      return `  From: ${from}${subj}\n  ${preview}`;
    });
    const extra =
      channelItems.length > 5 ? `\n  (+${channelItems.length - 5} more)` : "";
    sections.push(
      `${label} (${channelItems.length} new):\n${lines.join("\n\n")}${extra}`,
    );
  }

  const text = sections.join("\n\n─────────────\n\n");
  try {
    await botRef.api.sendMessage({
      chat_id: config.OWNER_TELEGRAM_ID,
      text: text.slice(0, 4000),
    });
    logger.info("comms:notify-sent", {
      items: items.length,
      channels: [...byChannel.keys()],
    });
  } catch (err) {
    logger.error("comms:notify-error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

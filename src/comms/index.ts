import type { Bot } from "gramio";
import type { ChannelProvider, InboxItem } from "./types.ts";
import { startPoller } from "./poller.ts";
import { initNotifier, queueNotification } from "./notify.ts";
import { createGmailProviders } from "./google/gmail.ts";
import { createGoogleCalendarProvider } from "./google/calendar.ts";
import { createAppleCalDAVProvider } from "./apple/caldav.ts";
import { createIMessageProvider } from "./imessage/client.ts";
import { createSlackProvider } from "./slack/client.ts";
import { createWhatsAppProvider } from "./whatsapp/client.ts";
import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import {
  detectContraLead,
  isDuplicate,
  generateIntakeResponse,
  saveDraft,
} from "./contra-intake.ts";

async function handleNewItems(items: InboxItem[], bot: Bot): Promise<void> {
  if (!config.CONTRA_INTAKE_ENABLED) {
    queueNotification(items);
    return;
  }

  const regularItems: InboxItem[] = [];

  for (const item of items) {
    const lead = detectContraLead(item);
    if (!lead) {
      regularItems.push(item);
      continue;
    }

    // Check dedup
    const alreadySeen = await isDuplicate(lead.threadId);
    if (alreadySeen) {
      logger.info("contra-intake:duplicate-skipped", {
        threadId: lead.threadId,
      });
      continue;
    }

    // Generate draft
    const draft = await generateIntakeResponse(lead);
    await saveDraft(lead, draft);

    // Send enriched Telegram notification
    try {
      const msg = await bot.api.sendMessage({
        chat_id: config.OWNER_TELEGRAM_ID,
        text: [
          `📩 *Contra Lead*`,
          `From: ${lead.leadName} <${lead.leadEmail}>`,
          `Subject: ${lead.subject}`,
          ``,
          `*Draft reply:*`,
          draft.slice(0, 800),
        ].join("\n"),
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Approve & Send",
                callback_data: `contra:approve:${lead.threadId}`,
              },
              {
                text: "✏️ Edit",
                callback_data: `contra:edit:${lead.threadId}`,
              },
              {
                text: "⏭ Skip",
                callback_data: `contra:skip:${lead.threadId}`,
              },
            ],
          ],
        },
      });
      logger.info("contra-intake:notified", {
        threadId: lead.threadId,
        leadEmail: lead.leadEmail,
        messageId: msg.message_id,
      });
    } catch (err) {
      logger.error("contra-intake:notify-failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (regularItems.length > 0) queueNotification(regularItems);
}

export function startComms(bot: Bot): void {
  if (!config.COMMS_ENABLED) return;

  initNotifier(bot);

  const providers: ChannelProvider[] = [
    ...createGmailProviders(),
    createGoogleCalendarProvider(),
    createAppleCalDAVProvider(),
    createIMessageProvider(),
    createSlackProvider(),
    createWhatsAppProvider(),
  ].filter((p): p is ChannelProvider => p !== null);

  if (providers.length === 0) {
    logger.warn("comms:no-providers", {
      note: "COMMS_ENABLED=true but no channels configured. Set COMMS_EMAIL_ACCOUNTS, COMMS_SLACK_BOT_TOKEN, etc.",
    });
    return;
  }

  for (const provider of providers) {
    startPoller(provider, (items) => void handleNewItems(items, bot));
  }

  logger.info("comms:started", {
    channels: providers.map((p) => p.id),
    count: providers.length,
  });
}

export { getItems, getUnreadCount, getSyncState } from "./inbox.ts";
export { getPollerStatus } from "./poller.ts";
export type { ChannelStatus, InboxItem, ChannelId } from "./types.ts";

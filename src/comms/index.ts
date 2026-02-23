import type { Bot } from "gramio";
import type { ChannelProvider } from "./types.ts";
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
    startPoller(provider, (items) => queueNotification(items));
  }

  logger.info("comms:started", {
    channels: providers.map((p) => p.id),
    count: providers.length,
  });
}

export { getItems, getUnreadCount, getSyncState } from "./inbox.ts";
export { getPollerStatus } from "./poller.ts";
export type { ChannelStatus, InboxItem, ChannelId } from "./types.ts";

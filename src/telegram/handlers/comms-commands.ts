import type { MessageContext } from "./shared.ts";
import { CHANNEL_LABELS } from "./shared.ts";

export async function handleInbox(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/inbox\s*/, "").trim() ?? "";
  const [subArg, idArg] = args.split(/\s+/);

  try {
    const { getItems, markRead } = await import("../../comms/inbox.ts");

    // /inbox read <id>
    if (subArg === "read" && idArg) {
      await markRead(idArg);
      await context.send(`Marked ${idArg} as read.`);
      return;
    }

    const channel = subArg as
      | import("../../comms/types.ts").ChannelId
      | undefined;
    const validChannels = [
      "gmail",
      "gmail-eddie",
      "google-calendar",
      "icloud-calendar",
      "imessage",
      "slack",
      "whatsapp",
    ];
    const filterChannel = validChannels.includes(channel ?? "")
      ? channel
      : undefined;

    const items = await getItems({
      channel: filterChannel,
      status: "unread",
      limit: 10,
    });
    if (items.length === 0) {
      await context.send(
        filterChannel
          ? `No unread items in ${filterChannel}.`
          : "Inbox is empty.",
      );
      return;
    }

    const lines = items.map((item) => {
      const ch = CHANNEL_LABELS[item.channel] ?? item.channel;
      const from = item.from.slice(0, 40);
      const subj = item.subject ? ` — ${item.subject.slice(0, 50)}` : "";
      const preview = item.preview.slice(0, 80);
      return `[${item.id?.slice(0, 8)}] ${ch}\nFrom: ${from}${subj}\n${preview}`;
    });

    await context.send(
      `Unread (${items.length}):\n\n${lines.join("\n\n─────\n\n")}`,
    );
  } catch (err) {
    await context.send(
      `Inbox error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleChannels(context: MessageContext): Promise<void> {
  try {
    const { getPollerStatus } = await import("../../comms/index.ts");
    const { getUnreadCount } = await import("../../comms/inbox.ts");

    const [pollers, counts] = await Promise.all([
      Promise.resolve(getPollerStatus()),
      getUnreadCount(),
    ]);

    if (pollers.length === 0) {
      await context.send(
        "No channels active. Set COMMS_ENABLED=true and configure channels.",
      );
      return;
    }

    const lines = pollers.map((p) => {
      const label = CHANNEL_LABELS[p.channel] ?? p.channel;
      const unread =
        counts[p.channel as import("../../comms/types.ts").ChannelId] ?? 0;
      const errors =
        p.consecutiveErrors > 0 ? ` ⚠️ ${p.consecutiveErrors} errors` : "";
      const last = p.lastPolledAt
        ? new Date(p.lastPolledAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })
        : "never";
      return `${label}${errors}\n  Unread: ${unread} · Last poll: ${last}`;
    });

    await context.send(`Channels:\n\n${lines.join("\n\n")}`);
  } catch (err) {
    await context.send(
      `Channels error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleCalendar(context: MessageContext): Promise<void> {
  const args = context.text?.replace(/^\/calendar\s*/, "").trim() ?? "";
  const days = args === "tomorrow" ? 2 : args === "week" ? 7 : 1;
  const label = days === 1 ? "today" : days === 2 ? "tomorrow" : "this week";

  try {
    const { getUpcomingCalendarEvents } =
      await import("../../comms/google/calendar.ts");
    const events = await getUpcomingCalendarEvents(days);
    await context.send(`Calendar ${label}:\n\n${events}`);
  } catch (err) {
    await context.send(
      `Calendar error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleDrive(context: MessageContext): Promise<void> {
  const query = context.text?.replace(/^\/drive\s*/, "").trim() ?? "";
  if (!query) {
    await context.send("Usage: /drive <search query>");
    return;
  }
  try {
    const { searchDrive, formatDriveResults } =
      await import("../../comms/google/drive.ts");
    const files = await searchDrive(query);
    const result = await formatDriveResults(files);
    await context.send(`Drive results for "${query}":\n\n${result}`);
  } catch (err) {
    await context.send(
      `Drive error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function handleSlack(context: MessageContext): Promise<void> {
  try {
    const { getItems } = await import("../../comms/inbox.ts");
    const items = await getItems({
      channel: "slack",
      status: "unread",
      limit: 10,
    });
    if (items.length === 0) {
      await context.send("No unread Slack messages.");
      return;
    }
    const lines = items.map((item) => {
      const from = item.from.slice(0, 30);
      const preview = item.preview.slice(0, 120);
      const ch = (item.metadata?.channelId as string) ?? "";
      return `${from}${ch ? ` in #${ch}` : ""}:\n${preview}`;
    });
    await context.send(
      `Slack (${items.length} unread):\n\n${lines.join("\n\n")}`,
    );
  } catch (err) {
    await context.send(
      `Slack error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

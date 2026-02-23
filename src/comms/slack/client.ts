import type { ChannelProvider, ChannelStatus, InboxItem } from "../types.ts";
import { getSyncState, setSyncState, getUnreadCount } from "../inbox.ts";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

const SLACK_API = "https://slack.com/api";
const POLL_INTERVAL_MS = 60_000;

interface SlackMessage {
  type: string;
  ts: string;
  text: string;
  user?: string;
  bot_id?: string;
  username?: string;
}

interface SlackUser {
  profile?: { display_name?: string; real_name?: string };
  real_name?: string;
}

const userCache = new Map<string, string>();

async function getUsername(userId: string, token: string): Promise<string> {
  if (userCache.has(userId)) return userCache.get(userId)!;
  try {
    const res = await fetch(`${SLACK_API}/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json()) as { user?: SlackUser };
    const name =
      data.user?.profile?.display_name ||
      data.user?.profile?.real_name ||
      data.user?.real_name ||
      userId;
    userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

async function pollChannel(
  channelId: string,
  token: string,
  oldest: string,
): Promise<InboxItem[]> {
  const res = await fetch(
    `${SLACK_API}/conversations.history?channel=${channelId}&oldest=${oldest}&limit=20`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`Slack history error: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; messages?: SlackMessage[]; error?: string };
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);

  const messages = (data.messages ?? []).filter((m) => m.type === "message" && !m.bot_id);
  const items: InboxItem[] = [];
  for (const msg of messages) {
    const from = msg.user ? await getUsername(msg.user, token) : (msg.username ?? "unknown");
    items.push({
      channel: "slack",
      externalId: `${channelId}-${msg.ts}`,
      from,
      preview: msg.text.slice(0, 200),
      receivedAt: new Date(parseFloat(msg.ts) * 1000).toISOString(),
      status: "unread",
      priority: "normal",
      metadata: { channelId, ts: msg.ts },
    });
  }
  return items;
}

export function createSlackProvider(): ChannelProvider | null {
  const token = config.COMMS_SLACK_BOT_TOKEN;
  if (!token) return null;

  const watchChannels = (config.COMMS_SLACK_WATCH_CHANNELS ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (watchChannels.length === 0) return null;

  let lastError: string | undefined;
  let lastPolledAt: string | undefined;

  logger.info("comms:slack-provider", { channels: watchChannels.length });
  return {
    id: "slack",
    pollIntervalMs: POLL_INTERVAL_MS,
    async poll() {
      const cursor = await getSyncState("slack");
      const oldest = cursor ?? String(Date.now() / 1000 - 3600);
      const allItems: InboxItem[] = [];

      for (const channelId of watchChannels) {
        try {
          allItems.push(...(await pollChannel(channelId, token, oldest)));
        } catch (err) {
          logger.warn("comms:slack-channel-error", {
            channel: channelId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      lastPolledAt = new Date().toISOString();
      lastError = undefined;
      await setSyncState("slack", String(Date.now() / 1000));
      return allItems;
    },
    async healthCheck() {
      try {
        const res = await fetch(`${SLACK_API}/auth.test`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await res.json()) as { ok: boolean };
        return data.ok;
      } catch {
        return false;
      }
    },
    async getStatus(): Promise<ChannelStatus> {
      const counts = await getUnreadCount();
      return {
        channel: "slack",
        enabled: true,
        healthy: !lastError,
        lastPolledAt,
        lastError,
        itemCount: counts.slack ?? 0,
      };
    },
  };
}

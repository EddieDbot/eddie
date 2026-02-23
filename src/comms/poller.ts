import type { ChannelProvider, InboxItem } from "./types.ts";
import { saveItems } from "./inbox.ts";
import { logger } from "../utils/logger.ts";

const MAX_BACKOFF_MS = 10 * 60_000;

interface PollerState {
  provider: ChannelProvider;
  timer: ReturnType<typeof setTimeout> | null;
  consecutiveErrors: number;
  lastPolledAt?: Date;
}

const pollers = new Map<string, PollerState>();

export function startPoller(
  provider: ChannelProvider,
  onItems: (items: InboxItem[]) => void,
): void {
  const state: PollerState = { provider, timer: null, consecutiveErrors: 0 };
  pollers.set(provider.id, state);

  async function poll(): Promise<void> {
    try {
      const items = await provider.poll();
      state.consecutiveErrors = 0;
      state.lastPolledAt = new Date();
      if (items.length > 0) {
        const newItems = await saveItems(items);
        if (newItems.length > 0) onItems(newItems);
      }
    } catch (err) {
      state.consecutiveErrors++;
      const backoff = Math.min(
        provider.pollIntervalMs * Math.pow(2, state.consecutiveErrors - 1),
        MAX_BACKOFF_MS,
      );
      logger.warn("comms:poll-error", {
        channel: provider.id,
        error: err instanceof Error ? err.message : String(err),
        consecutiveErrors: state.consecutiveErrors,
        backoffMs: backoff,
      });
      state.timer = setTimeout(() => schedule(), backoff);
      return;
    }
    schedule();
  }

  function schedule(): void {
    state.timer = setTimeout(() => void poll(), provider.pollIntervalMs);
  }

  // First poll after 5s startup delay
  state.timer = setTimeout(() => void poll(), 5_000);
  logger.info("comms:poller-started", {
    channel: provider.id,
    intervalMs: provider.pollIntervalMs,
  });
}

export function stopPoller(channelId: string): void {
  const state = pollers.get(channelId);
  if (state?.timer) {
    clearTimeout(state.timer);
    state.timer = null;
    pollers.delete(channelId);
    logger.info("comms:poller-stopped", { channel: channelId });
  }
}

export function stopAllPollers(): void {
  for (const id of pollers.keys()) stopPoller(id);
}

export function getPollerStatus(): Array<{
  channel: string;
  consecutiveErrors: number;
  lastPolledAt?: string;
}> {
  return [...pollers.entries()].map(([id, state]) => ({
    channel: id,
    consecutiveErrors: state.consecutiveErrors,
    lastPolledAt: state.lastPolledAt?.toISOString(),
  }));
}

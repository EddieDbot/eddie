import { getSupabase, memoryEnabled } from "../memory/client.ts";
import type { InboxItem, ChannelId } from "./types.ts";
import { logger } from "../utils/logger.ts";

export async function saveItems(items: InboxItem[]): Promise<InboxItem[]> {
  if (!memoryEnabled || items.length === 0) return [];
  const rows = items.map((item) => ({
    channel: item.channel,
    external_id: item.externalId,
    from_addr: item.from,
    subject: item.subject ?? null,
    preview: item.preview,
    body: item.body ?? null,
    received_at: item.receivedAt,
    status: item.status,
    priority: item.priority,
    metadata: item.metadata ?? null,
  }));
  const { data, error } = await getSupabase()
    .from("inbox")
    .upsert(rows, { onConflict: "channel,external_id", ignoreDuplicates: true })
    .select("external_id, channel");
  if (error) logger.error("inbox:save", { error: error.message });
  // Only return items that were actually inserted (ignoreDuplicates skips conflicts)
  const insertedIds = new Set(
    (data ?? []).map((r) => `${r.channel}:${r.external_id}`),
  );
  return items.filter((item) =>
    insertedIds.has(`${item.channel}:${item.externalId}`),
  );
}

export async function getItems(
  filter: { channel?: ChannelId; status?: string; limit?: number } = {},
): Promise<InboxItem[]> {
  if (!memoryEnabled) return [];
  let q = getSupabase()
    .from("inbox")
    .select("*")
    .order("received_at", { ascending: false })
    .limit(filter.limit ?? 20);
  if (filter.channel) q = q.eq("channel", filter.channel);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) {
    logger.error("inbox:get", { error: error.message });
    return [];
  }
  return (data ?? []).map(rowToItem);
}

export async function markRead(id: string): Promise<void> {
  if (!memoryEnabled) return;
  await getSupabase().from("inbox").update({ status: "read" }).eq("id", id);
}

export async function markArchived(id: string): Promise<void> {
  if (!memoryEnabled) return;
  await getSupabase().from("inbox").update({ status: "archived" }).eq("id", id);
}

export async function getUnreadCount(): Promise<
  Partial<Record<ChannelId, number>>
> {
  if (!memoryEnabled) return {};
  const { data } = await getSupabase()
    .from("inbox")
    .select("channel")
    .eq("status", "unread");
  const counts: Partial<Record<ChannelId, number>> = {};
  for (const row of data ?? []) {
    const ch = row.channel as ChannelId;
    counts[ch] = (counts[ch] ?? 0) + 1;
  }
  return counts;
}

export async function getSyncState(
  channel: ChannelId | string,
): Promise<string | null> {
  if (!memoryEnabled) return null;
  const { data } = await getSupabase()
    .from("comms_sync_state")
    .select("cursor")
    .eq("channel", channel)
    .maybeSingle();
  return (data as { cursor?: string } | null)?.cursor ?? null;
}

export async function setSyncState(
  channel: ChannelId | string,
  cursor: string,
): Promise<void> {
  if (!memoryEnabled) return;
  await getSupabase()
    .from("comms_sync_state")
    .upsert(
      { channel, cursor, last_polled_at: new Date().toISOString() },
      { onConflict: "channel" },
    );
}

function rowToItem(row: Record<string, unknown>): InboxItem {
  return {
    id: row.id as string,
    channel: row.channel as ChannelId,
    externalId: row.external_id as string,
    from: row.from_addr as string,
    subject: (row.subject as string | null) ?? undefined,
    preview: row.preview as string,
    body: (row.body as string | null) ?? undefined,
    receivedAt: row.received_at as string,
    status: row.status as InboxItemStatus,
    priority: row.priority as InboxItemPriority,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
  };
}

type InboxItemStatus = "unread" | "read" | "archived";
type InboxItemPriority = "high" | "normal" | "low";

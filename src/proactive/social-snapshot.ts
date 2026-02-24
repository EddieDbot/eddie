import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";

export type SocialSnapshot = {
  platform: string;
  handle: string;
  followers?: number;
  following?: number;
  posts?: number;
  likes?: number;
  engagementRate?: number;
  extra?: Record<string, unknown>;
};

export async function saveSnapshot(snapshot: SocialSnapshot): Promise<void> {
  if (!config.SOCIAL_SNAPSHOT_ENABLED || !memoryEnabled) return;

  const { error } = await getSupabase()
    .from("social_snapshots")
    .insert({
      platform: snapshot.platform,
      handle: snapshot.handle,
      followers: snapshot.followers,
      following: snapshot.following,
      posts: snapshot.posts,
      likes: snapshot.likes,
      engagement_rate: snapshot.engagementRate,
      extra: snapshot.extra ?? {},
    });

  if (error) {
    logger.warn("social-snapshot:save-error", { error: error.message });
  }
}

export async function getGrowthTrend(
  platform: string,
  handle: string,
  days = 30,
): Promise<{
  current?: SocialSnapshot;
  previous?: SocialSnapshot;
  followerDelta?: number;
}> {
  if (!memoryEnabled) return {};

  const { data } = await getSupabase()
    .from("social_snapshots")
    .select("*")
    .eq("platform", platform)
    .eq("handle", handle)
    .order("snapped_at", { ascending: false })
    .limit(2);

  if (!data || data.length === 0) return {};

  const current = data[0];
  const previous = data[1];

  const followerDelta =
    current.followers != null && previous?.followers != null
      ? current.followers - previous.followers
      : undefined;

  return {
    current: {
      platform,
      handle,
      followers: current.followers,
      posts: current.posts,
    },
    previous: previous
      ? { platform, handle, followers: previous.followers }
      : undefined,
    followerDelta,
  };
}

export async function formatSnapshotSummary(
  platform: string,
  handle: string,
): Promise<string> {
  const { current, followerDelta } = await getGrowthTrend(platform, handle);
  if (!current) return `No data for ${platform}/${handle}`;

  const delta =
    followerDelta != null
      ? ` (${followerDelta >= 0 ? "+" : ""}${followerDelta} since last check)`
      : "";
  return `${platform} @${handle}: ${current.followers ?? "?"} followers${delta}`;
}

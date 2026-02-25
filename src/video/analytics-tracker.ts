import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { appendAnalyticsEntry } from "./working-doc.ts";
import { getYouTubeAccessToken } from "./youtube-auth.ts";

export type VideoStats = {
  viewCount: number;
  likeCount: number;
  commentCount: number;
  favoriteCount: number;
};

export async function pullVideoStats(videoId: string): Promise<VideoStats | null> {
  try {
    const accessToken = await getYouTubeAccessToken();

    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", videoId);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      logger.error("analytics-tracker:api-error", { videoId, status: response.status });
      return null;
    }

    const data = await response.json() as {
      items?: Array<{
        statistics: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
          favoriteCount?: string;
        };
      }>;
    };
    const stats = data.items?.[0]?.statistics;
    if (!stats) {
      logger.warn("analytics-tracker:no-stats", { videoId });
      return null;
    }

    return {
      viewCount: parseInt(stats.viewCount ?? "0", 10),
      likeCount: parseInt(stats.likeCount ?? "0", 10),
      commentCount: parseInt(stats.commentCount ?? "0", 10),
      favoriteCount: parseInt(stats.favoriteCount ?? "0", 10),
    };
  } catch (err) {
    logger.error("analytics-tracker:pull-failed", { videoId, error: String(err) });
    return null;
  }
}

async function saveToDB(
  renderId: string,
  videoId: string,
  headline: string,
  stats: VideoStats,
  hoursAfterPublish: number
): Promise<void> {
  if (!memoryEnabled) return;

  const { error } = await getSupabase().from("video_analytics").insert({
    render_id: renderId,
    video_id: videoId,
    headline,
    view_count: stats.viewCount,
    like_count: stats.likeCount,
    comment_count: stats.commentCount,
    hours_after_publish: hoursAfterPublish,
  });

  if (error) {
    logger.error("analytics-tracker:db-error", { renderId, error: error.message });
  }
}

export async function scheduleAnalyticsPull(
  videoId: string,
  renderId: string,
  headline: string,
  publishedAt: Date
): Promise<void> {
  if (!memoryEnabled) {
    logger.warn("analytics-tracker:schedule-skipped", { reason: "memory disabled" });
    return;
  }

  const scheduled48h = new Date(publishedAt.getTime() + 48 * 60 * 60 * 1000);
  const scheduled7d = new Date(publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000);

  const rows = [
    {
      render_id: renderId,
      video_id: videoId,
      headline,
      scheduled_for: scheduled48h.toISOString(),
      hours_after_publish: 48,
      status: "pending",
    },
    {
      render_id: renderId,
      video_id: videoId,
      headline,
      scheduled_for: scheduled7d.toISOString(),
      hours_after_publish: 168,
      status: "pending",
    },
  ];

  const { error } = await getSupabase().from("video_analytics_queue").insert(rows);

  if (error) {
    logger.error("analytics-tracker:schedule-error", { renderId, error: error.message });
  } else {
    logger.info("analytics-tracker:scheduled", {
      videoId,
      pull48hAt: scheduled48h.toISOString(),
      pull7dAt: scheduled7d.toISOString(),
    });
  }
}

export async function processAnalyticsQueue(): Promise<void> {
  if (!memoryEnabled) return;

  const now = new Date().toISOString();

  const { data: dueRows, error: fetchError } = await getSupabase()
    .from("video_analytics_queue")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_for", now);

  if (fetchError) {
    logger.error("analytics-tracker:queue-fetch-error", { error: fetchError.message });
    return;
  }

  if (!dueRows || dueRows.length === 0) return;

  logger.info("analytics-tracker:queue-processing", { count: dueRows.length });

  for (const row of dueRows) {
    const { id, render_id, video_id, headline, hours_after_publish } = row as {
      id: string;
      render_id: string;
      video_id: string;
      headline: string;
      hours_after_publish: number;
    };

    await getSupabase()
      .from("video_analytics_queue")
      .update({ status: "attempted_at", attempted_at: now })
      .eq("id", id);

    logger.info("analytics-tracker:pulling", { videoId: video_id, hoursAfterPublish: hours_after_publish });

    const stats = await pullVideoStats(video_id);

    if (!stats) {
      await getSupabase()
        .from("video_analytics_queue")
        .update({ status: "failed" })
        .eq("id", id);
      logger.warn("analytics-tracker:queue-item-failed", { id, videoId: video_id });
      continue;
    }

    await saveToDB(render_id, video_id, headline, stats, hours_after_publish);

    await appendAnalyticsEntry({
      youtubeVideoId: video_id,
      headline,
      views: stats.viewCount,
      likes: stats.likeCount,
      comments: stats.commentCount,
      pulledAt: new Date().toISOString(),
      hoursAfterPublish: hours_after_publish,
    });

    const { error: doneError } = await getSupabase()
      .from("video_analytics_queue")
      .update({ status: "done" })
      .eq("id", id);

    if (doneError) {
      logger.error("analytics-tracker:queue-done-error", { id, error: doneError.message });
    } else {
      logger.info("analytics-tracker:queue-item-done", { id, videoId: video_id, hoursAfterPublish: hours_after_publish });
    }
  }
}

export function startAnalyticsPoller(): void {
  const POLL_INTERVAL_MS = 15 * 60 * 1000;

  logger.info("analytics-tracker:poller-started", { intervalMs: POLL_INTERVAL_MS });

  setInterval(() => {
    void processAnalyticsQueue();
  }, POLL_INTERVAL_MS);
}

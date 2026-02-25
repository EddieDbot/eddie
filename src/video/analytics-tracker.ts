import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { appendAnalyticsEntry } from "./working-doc.ts";
import { getYouTubeAccessToken } from "./youtube-auth.ts";

type VideoStats = {
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

export function scheduleAnalyticsPull(
  videoId: string,
  renderId: string,
  headline: string,
  publishedAt: Date
): void {
  const MS_48H = 48 * 60 * 60 * 1000;
  const MS_7D = 7 * 24 * 60 * 60 * 1000;

  const pull = async (hoursAfterPublish: number): Promise<void> => {
    logger.info("analytics-tracker:pulling", { videoId, hoursAfterPublish });
    const stats = await pullVideoStats(videoId);
    if (!stats) return;

    await saveToDB(renderId, videoId, headline, stats, hoursAfterPublish);

    await appendAnalyticsEntry({
      youtubeVideoId: videoId,
      headline,
      views: stats.viewCount,
      likes: stats.likeCount,
      comments: stats.commentCount,
      pulledAt: new Date().toISOString(),
      hoursAfterPublish,
    });
  };

  const now = Date.now();
  const delayFor48h = Math.max(0, publishedAt.getTime() + MS_48H - now);
  const delayFor7d = Math.max(0, publishedAt.getTime() + MS_7D - now);

  setTimeout(() => void pull(48), delayFor48h);
  setTimeout(() => void pull(168), delayFor7d);

  logger.info("analytics-tracker:scheduled", {
    videoId,
    pull48hInMs: delayFor48h,
    pull7dInMs: delayFor7d,
  });
}

// Detects outlier videos (>10x channel mean) from competitor channels
// Used to identify viral formats for style reference

import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";
import { getYouTubeAccessToken } from "./youtube-auth.ts";

export type OutlierVideo = {
  videoId: string;
  title: string;
  viewCount: number;
  channelMeanViews: number;
  multiplier: number; // viewCount / channelMean
  publishedAt: string;
  url: string;
};

async function fetchChannelVideos(channelId: string, maxResults = 50): Promise<Array<{
  videoId: string;
  title: string;
  viewCount: number;
  publishedAt: string;
}>> {
  const token = await getYouTubeAccessToken();

  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
  );
  if (!channelRes.ok) return [];

  const channelData = await channelRes.json() as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) return [];

  const playlistRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=${maxResults}&playlistId=${uploadsPlaylistId}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
  );
  if (!playlistRes.ok) return [];

  const playlistData = await playlistRes.json() as {
    items?: Array<{ contentDetails?: { videoId?: string; videoPublishedAt?: string } }>;
  };
  const videoIds = (playlistData.items ?? [])
    .map(i => i.contentDetails?.videoId)
    .filter(Boolean) as string[];

  if (videoIds.length === 0) return [];

  const statsRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(",")}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }
  );
  if (!statsRes.ok) return [];

  const statsData = await statsRes.json() as {
    items?: Array<{
      id: string;
      snippet?: { title?: string; publishedAt?: string };
      statistics?: { viewCount?: string };
    }>;
  };

  return (statsData.items ?? []).map(item => ({
    videoId: item.id,
    title: item.snippet?.title ?? "",
    viewCount: parseInt(item.statistics?.viewCount ?? "0", 10),
    publishedAt: item.snippet?.publishedAt ?? "",
  }));
}

export async function detectOutliers(channelIds: string[]): Promise<OutlierVideo[]> {
  if (!config.VIDEO_OUTLIER_DETECTION_ENABLED) return [];

  const outliers: OutlierVideo[] = [];

  for (const channelId of channelIds) {
    try {
      const videos = await fetchChannelVideos(channelId);
      if (videos.length === 0) continue;

      const mean = videos.reduce((sum, v) => sum + v.viewCount, 0) / videos.length;
      const threshold = mean * 10;

      for (const video of videos) {
        if (video.viewCount > threshold) {
          outliers.push({
            videoId: video.videoId,
            title: video.title,
            viewCount: video.viewCount,
            channelMeanViews: mean,
            multiplier: video.viewCount / mean,
            publishedAt: video.publishedAt,
            url: `https://www.youtube.com/watch?v=${video.videoId}`,
          });
        }
      }

      logger.info("outlier-detector:channel-scanned", {
        channelId,
        videoCount: videos.length,
        mean: Math.round(mean),
        outliersFound: outliers.filter(o => o.videoId).length,
      });
    } catch (err) {
      logger.error("outlier-detector:channel-error", { channelId, error: String(err) });
    }
  }

  outliers.sort((a, b) => b.multiplier - a.multiplier);
  return outliers;
}

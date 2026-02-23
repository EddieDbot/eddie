import { config } from "../config.ts";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export interface ChannelStats {
  subscriberCount: string;
  viewCount: string;
  videoCount: string;
  title: string;
}

export interface VideoItem {
  id: string;
  title: string;
  publishedAt: string;
  viewCount: string;
  likeCount: string;
}

export async function getChannelStats(
  channelId: string,
): Promise<ChannelStats | null> {
  try {
    const url = `${YOUTUBE_API_BASE}/channels?part=statistics,snippet&id=${channelId}&key=${config.GOOGLE_API_KEY}`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      items?: Array<{
        statistics: Record<string, string>;
        snippet: { title: string };
      }>;
    };
    const channel = data.items?.[0];
    if (!channel) return null;
    return {
      subscriberCount: channel.statistics.subscriberCount ?? "0",
      viewCount: channel.statistics.viewCount ?? "0",
      videoCount: channel.statistics.videoCount ?? "0",
      title: channel.snippet.title,
    };
  } catch {
    return null;
  }
}

export async function getRecentVideos(
  channelId: string,
  maxResults = 5,
): Promise<VideoItem[]> {
  try {
    const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&channelId=${channelId}&order=date&maxResults=${maxResults}&type=video&key=${config.GOOGLE_API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = (await searchRes.json()) as {
      items?: Array<{ id: { videoId: string } }>;
    };
    const videoIds = searchData.items?.map((i) => i.id.videoId).join(",");
    if (!videoIds) return [];

    const statsUrl = `${YOUTUBE_API_BASE}/videos?part=statistics,snippet&id=${videoIds}&key=${config.GOOGLE_API_KEY}`;
    const statsRes = await fetch(statsUrl);
    const statsData = (await statsRes.json()) as {
      items?: Array<{
        id: string;
        snippet: { title: string; publishedAt: string };
        statistics: { viewCount?: string; likeCount?: string };
      }>;
    };

    return (statsData.items ?? []).map((v) => ({
      id: v.id,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      viewCount: v.statistics.viewCount ?? "0",
      likeCount: v.statistics.likeCount ?? "0",
    }));
  } catch {
    return [];
  }
}

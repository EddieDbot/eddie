import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

export type VideoStory = {
  id: string;
  headline: string;
  summary: string | null;
  source: string;
  sourceUrl: string;
  publishedAt: string | null;
};

const RSS_FEEDS = [
  // ── Official AI Lab Blogs ──
  { name: "OpenAI", url: "https://openai.com/news/rss.xml" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml" },
  { name: "HuggingFace", url: "https://huggingface.co/blog/feed.xml" },
  // ── Tech News ──
  {
    name: "The Verge AI",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  },
  {
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  { name: "MIT Tech Review", url: "https://www.technologyreview.com/feed/" },
  {
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
  },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/" },
  // ── AI Newsletters ──
  { name: "TLDR AI", url: "https://tldr.tech/api/rss/ai" },
  { name: "Import AI", url: "https://importai.substack.com/feed" },
  // ── YouTube Channels (Atom format) ──
  {
    name: "Fireship",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA",
  },
  {
    name: "Two Minute Papers",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbfYPyITQ-7l4upoX8nvctg",
  },
  {
    name: "AI Explained",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCNJ1Ymd5yFuUPtn21xtRbbw",
  },
];

type RawItem = {
  headline: string;
  summary: string | null;
  sourceUrl: string;
  publishedAt: string | null;
};

function extractTagContent(xml: string, tag: string): string | null {
  const match = xml.match(
    new RegExp(
      `<${tag}[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/${tag}>`,
      "i",
    ),
  );
  return match?.[1]?.trim() ?? null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function parseItems(xml: string): RawItem[] {
  const items: RawItem[] = [];

  // Support both RSS (<item>) and Atom (<entry>) formats
  const isAtom = xml.includes("<feed") && xml.includes("<entry>");
  const blockPattern = isAtom
    ? /<entry[\s>]([\s\S]*?)<\/entry>/gi
    : /<item[\s>]([\s\S]*?)<\/item>/gi;
  const blocks = xml.match(blockPattern) ?? [];

  for (const block of blocks) {
    const headline = extractTagContent(block, "title");
    if (!headline) continue;

    // Atom: <link rel="alternate" href="..."/> — RSS: <link>url</link>
    const rawLink = extractTagContent(block, "link");
    const hrefMatch = block.match(/<link[^>]+href="([^"]+)"/);
    const plainMatch = block.match(/<link>([^<]+)<\/link>/);
    const sourceUrl = hrefMatch?.[1] ?? rawLink ?? plainMatch?.[1] ?? null;
    if (!sourceUrl) continue;

    const rawDesc =
      extractTagContent(block, "summary") ??
      extractTagContent(block, "description") ??
      extractTagContent(block, "content:encoded") ??
      extractTagContent(block, "content") ??
      null;
    const summary = rawDesc ? stripHtml(rawDesc).slice(0, 500) || null : null;

    const rawDate =
      extractTagContent(block, "published") ??
      extractTagContent(block, "updated") ??
      extractTagContent(block, "pubDate") ??
      extractTagContent(block, "dc:date") ??
      null;
    const publishedAt = rawDate ? new Date(rawDate).toISOString() : null;

    items.push({
      headline: stripHtml(headline),
      summary,
      sourceUrl,
      publishedAt,
    });
  }

  return items;
}

async function fetchFeed(feed: {
  name: string;
  url: string;
}): Promise<RawItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "EDDIE/1.0 (RSS reader)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn("news-gatherer:fetch-failed", {
        source: feed.name,
        status: res.status,
      });
      return [];
    }
    const xml = await res.text();
    return parseItems(xml);
  } catch (err) {
    logger.warn("news-gatherer:fetch-error", {
      source: feed.name,
      error: String(err),
    });
    return [];
  }
}

export async function gatherAINews(): Promise<number> {
  if (!memoryEnabled) {
    logger.warn("news-gatherer:skipped", { reason: "supabase not configured" });
    return 0;
  }

  const supabase = getSupabase();
  const results = await Promise.allSettled(RSS_FEEDS.map(fetchFeed));

  const allItems: Array<RawItem & { source: string }> = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      const feedName = RSS_FEEDS[i]?.name ?? "Unknown";
      for (const item of result.value) {
        allItems.push({ ...item, source: feedName });
      }
    }
  }

  if (allItems.length === 0) return 0;

  const rows = allItems.map((item) => ({
    headline: item.headline,
    summary: item.summary,
    source: item.source,
    source_url: item.sourceUrl,
    published_at: item.publishedAt,
  }));

  const { data, error } = await supabase
    .from("video_stories")
    .upsert(rows, { onConflict: "source_url", ignoreDuplicates: true })
    .select("id");

  if (error) {
    logger.error("news-gatherer:insert-error", { error: error.message });
    return 0;
  }

  const count = data?.length ?? 0;
  logger.info("news-gatherer:done", {
    fetched: allItems.length,
    inserted: count,
  });
  return count;
}

export async function pickTopStory(): Promise<VideoStory | null> {
  if (!memoryEnabled) return null;

  const { data, error } = await getSupabase()
    .from("video_stories")
    .select("id, headline, summary, source, source_url, published_at")
    .is("used_in_video", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    if (error?.code !== "PGRST116") {
      logger.warn("news-gatherer:pick-error", { error: error?.message });
    }
    return null;
  }

  return {
    id: data.id,
    headline: data.headline,
    summary: data.summary ?? null,
    source: data.source,
    sourceUrl: data.source_url,
    publishedAt: data.published_at ?? null,
  };
}

export async function markStoryUsed(
  storyId: string,
  videoId: string,
): Promise<void> {
  if (!memoryEnabled) return;

  const { error } = await getSupabase()
    .from("video_stories")
    .update({ used_in_video: videoId })
    .eq("id", storyId);

  if (error) {
    logger.error("news-gatherer:mark-used-error", {
      storyId,
      videoId,
      error: error.message,
    });
  }
}

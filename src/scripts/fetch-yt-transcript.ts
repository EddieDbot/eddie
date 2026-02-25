/**
 * Fetch YouTube transcript and save to Brain Vault
 * Usage: bun run src/scripts/fetch-yt-transcript.ts <videoId> <outputPath>
 *
 * Example:
 *   bun run src/scripts/fetch-yt-transcript.ts _CttoOfvh1I \
 *     "/home/na/brain-vault/30 - Resources/ai-money/notes/raw-transcript-CttoOfvh1I.md"
 */

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const videoId = process.argv[2];
const outputPath = process.argv[3];

if (!videoId || !outputPath) {
  console.error("Usage: bun run fetch-yt-transcript.ts <videoId> <outputPath>");
  process.exit(1);
}

const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

// Fetch transcript via YouTube's timedtext API
async function fetchTranscript(vid: string): Promise<{ text: string; start: number; dur: number }[]> {
  // Step 1: fetch the video page to get the innertube API key and params
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!pageRes.ok) throw new Error(`Failed to fetch video page: ${pageRes.status}`);
  const html = await pageRes.text();

  // Extract captions track URL from ytInitialPlayerResponse
  const captionMatch = html.match(/"captionTracks":\[(\{.*?\})\]/);
  if (!captionMatch) {
    // Try alternate pattern
    const altMatch = html.match(/"captionTracks":\[([\s\S]*?)\]/);
    if (!altMatch) throw new Error("No caption tracks found for this video");

    const tracks = altMatch[1];
    const urlMatch = tracks.match(/"baseUrl":"([^"]+)"/);
    if (!urlMatch) throw new Error("No caption URL found");

    const captionUrl = urlMatch[1].replace(/\\u0026/g, "&");
    return fetchCaptionXml(captionUrl);
  }

  const urlMatch = captionMatch[1].match(/"baseUrl":"([^"]+)"/);
  if (!urlMatch) throw new Error("No baseUrl in caption track");

  const captionUrl = urlMatch[1].replace(/\\u0026/g, "&");
  return fetchCaptionXml(captionUrl);
}

async function fetchCaptionXml(url: string): Promise<{ text: string; start: number; dur: number }[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch captions: ${res.status}`);
  const xml = await res.text();

  const entries: { text: string; start: number; dur: number }[] = [];
  const regex = /<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const text = match[3]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, " ")
      .trim();

    entries.push({
      start: parseFloat(match[1]),
      dur: parseFloat(match[2]),
      text,
    });
  }

  return entries;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function fetchVideoTitle(vid: string): Promise<{ title: string; channel: string }> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vid}&format=json`);
    if (res.ok) {
      const data = (await res.json()) as { title?: string; author_name?: string };
      return {
        title: data.title || "Unknown Title",
        channel: data.author_name || "Unknown Channel",
      };
    }
  } catch {}
  return { title: "Unknown Title", channel: "Unknown Channel" };
}

async function main() {
  console.log(`Fetching transcript for video: ${videoId}`);

  const [meta, transcript] = await Promise.all([fetchVideoTitle(videoId), fetchTranscript(videoId)]);

  console.log(`Title: ${meta.title}`);
  console.log(`Channel: ${meta.channel}`);
  console.log(`Transcript entries: ${transcript.length}`);

  const lines = transcript
    .map((entry) => `[${formatTimestamp(entry.start)}] ${entry.text}`)
    .join("\n");

  const totalDuration = transcript.length > 0 ? transcript[transcript.length - 1].start + transcript[transcript.length - 1].dur : 0;
  const durationFormatted = formatTimestamp(totalDuration);

  const content = `# ${meta.title}

**Channel:** ${meta.channel}
**URL:** ${videoUrl}
**Video ID:** ${videoId}
**Duration:** ~${durationFormatted}
**Date Extracted:** 2026-02-24
**Transcript Lines:** ${transcript.length}

---

## Full Transcript

${lines}
`;

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  console.log(`Saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

/**
 * Fetch transcripts for all videos in a YouTube playlist
 * Usage: bun run src/scripts/fetch-yt-playlist.ts <playlistId> <outputDir>
 *
 * Example:
 *   bun run src/scripts/fetch-yt-playlist.ts PLuNvpk1vDsgbOtdmAHzLOPkPPB_mMjYsJ \
 *     "~/brain-vault/30 - Resources/session-nuggets/api-cost-reduction/"
 *
 * Note: This script runs fetch-yt-transcript.ts for each video.
 * Memory note: fetch-yt-transcript.ts timedtext API returns 0 entries for some videos — use yt-dlp as fallback.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";

const playlistId = process.argv[2];
const outputDir = process.argv[3];

if (!playlistId || !outputDir) {
  console.error(
    "Usage: bun run src/scripts/fetch-yt-playlist.ts <playlistId> <outputDir>",
  );
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

// Fetch playlist RSS feed to get video IDs
async function getPlaylistVideos(): Promise<
  Array<{ id: string; title: string }>
> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  console.log(`Fetching playlist feed: ${feedUrl}`);

  const res = await fetch(feedUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; EDDIE/1.0)" },
  });

  if (!res.ok) {
    throw new Error(`Playlist feed failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) ?? [];

  if (entries.length === 0) {
    // Playlist may have more than 15 videos (RSS limit) — try yt-dlp
    console.log("RSS returned 0 entries, trying yt-dlp...");
    return getPlaylistVideosViaYtDlp();
  }

  return entries
    .map((entry) => {
      const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? "";
      const rawTitle = entry.match(/<title>([^<]+)<\/title>/)?.[1] ?? "";
      const title = rawTitle
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return { id, title };
    })
    .filter((v) => v.id);
}

async function getPlaylistVideosViaYtDlp(): Promise<
  Array<{ id: string; title: string }>
> {
  return new Promise((resolve, reject) => {
    const args = [
      "--flat-playlist",
      "--print",
      "%(id)s|||%(title)s",
      "--no-warnings",
      `https://youtube.com/playlist?list=${playlistId}`,
    ];

    let output = "";
    const proc = spawn("yt-dlp", args);
    proc.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      process.stderr.write(d);
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`));
        return;
      }
      const videos = output
        .trim()
        .split("\n")
        .filter((l) => l.includes("|||"))
        .map((l) => {
          const [id, ...rest] = l.split("|||");
          return { id: id.trim(), title: rest.join("|||").trim() };
        })
        .filter((v) => v.id);
      resolve(videos);
    });
    proc.on("error", reject);
  });
}

// Fetch transcript via YouTube timedtext API (reusing logic from fetch-yt-transcript.ts)
async function fetchTranscript(
  vid: string,
): Promise<{ text: string; start: number; dur: number }[]> {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!pageRes.ok)
    throw new Error(`Failed to fetch video page: ${pageRes.status}`);
  const html = await pageRes.text();

  const altMatch = html.match(/"captionTracks":\[([\s\S]*?)\]/);
  if (!altMatch) throw new Error("No caption tracks found");

  const tracks = altMatch[1];
  const urlMatch = tracks.match(/"baseUrl":"([^"]+)"/);
  if (!urlMatch) throw new Error("No caption URL found");

  const captionUrl = urlMatch[1].replace(/\\u0026/g, "&");

  const captionRes = await fetch(captionUrl);
  if (!captionRes.ok)
    throw new Error(`Failed to fetch captions: ${captionRes.status}`);
  const xml = await captionRes.text();

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
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Fallback: yt-dlp VTT
async function fetchTranscriptViaYtDlp(
  videoId: string,
): Promise<string | null> {
  const tmpFile = `/tmp/yt-playlist-${videoId}.vtt`;
  return new Promise((resolve) => {
    const proc = spawn("yt-dlp", [
      "--write-auto-sub",
      "--skip-download",
      "--sub-lang",
      "en",
      "--sub-format",
      "vtt",
      "--output",
      `/tmp/yt-playlist-${videoId}.%(ext)s`,
      "--no-warnings",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    proc.on("close", () => {
      if (existsSync(tmpFile)) {
        const content = Bun.file(tmpFile)
          .text()
          .then((vtt) => {
            // Clean VTT
            let text = vtt
              .replace(/^WEBVTT[\s\S]*?\n\n/, "")
              .replace(
                /\d{2}:\d{2}:\d{2}[.,]\d{3} --> \d{2}:\d{2}:\d{2}[.,]\d{3}[^\n]*\n/g,
                "",
              )
              .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
              .replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
            const lines = text
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);
            const deduped: string[] = [];
            let prev = "";
            for (const line of lines) {
              if (line !== prev) deduped.push(line);
              prev = line;
            }
            return deduped.join(" ");
          });
        resolve(content);
      } else {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

async function main() {
  console.log(`\nFetching playlist: ${playlistId}`);
  console.log(`Output directory: ${outputDir}\n`);

  const videos = await getPlaylistVideos();
  console.log(`Found ${videos.length} videos\n`);

  const results: Array<{
    video: { id: string; title: string };
    success: boolean;
    chars: number;
  }> = [];

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const safeTitle = video.title
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .slice(0, 60);
    const outputPath = join(
      outputDir,
      `${String(i + 1).padStart(2, "0")}-${video.id}-${safeTitle}.md`,
    );

    process.stdout.write(`[${i + 1}/${videos.length}] ${video.title} ... `);

    // Skip if already exists
    if (existsSync(outputPath)) {
      console.log("already exists, skipping");
      results.push({ video, success: true, chars: 0 });
      continue;
    }

    try {
      let transcript: { text: string; start: number; dur: number }[] = [];
      let ytDlpFallback: string | null = null;

      try {
        transcript = await fetchTranscript(video.id);
      } catch {
        // Fallback to yt-dlp
        ytDlpFallback = await fetchTranscriptViaYtDlp(video.id);
      }

      let content: string;

      if (transcript.length > 0) {
        const lines = transcript
          .map((e) => `[${formatTimestamp(e.start)}] ${e.text}`)
          .join("\n");
        const duration =
          transcript[transcript.length - 1]?.start +
            transcript[transcript.length - 1]?.dur || 0;

        content = `# ${video.title}

**URL:** https://www.youtube.com/watch?v=${video.id}
**Playlist:** https://youtube.com/playlist?list=${playlistId}
**Duration:** ~${formatTimestamp(duration)}
**Entries:** ${transcript.length}

---

## Transcript

${lines}
`;
        console.log(`${transcript.length} entries`);
      } else if (ytDlpFallback) {
        content = `# ${video.title}

**URL:** https://www.youtube.com/watch?v=${video.id}
**Playlist:** https://youtube.com/playlist?list=${playlistId}
**Source:** yt-dlp auto-captions

---

## Transcript

${ytDlpFallback}
`;
        console.log(`yt-dlp fallback, ${ytDlpFallback.length} chars`);
      } else {
        content = `# ${video.title}

**URL:** https://www.youtube.com/watch?v=${video.id}
**Status:** No transcript available

`;
        console.log("no transcript");
      }

      writeFileSync(outputPath, content, "utf8");
      results.push({
        video,
        success: !!transcript.length || !!ytDlpFallback,
        chars: content.length,
      });
    } catch (err) {
      console.log(`ERROR: ${(err as Error).message}`);
      results.push({ video, success: false, chars: 0 });
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 800));
  }

  // Summary
  const succeeded = results.filter((r) => r.success).length;
  console.log(`\n=== Complete ===`);
  console.log(`Videos: ${videos.length}`);
  console.log(`Transcripts fetched: ${succeeded}/${videos.length}`);
  console.log(`Output directory: ${outputDir}`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

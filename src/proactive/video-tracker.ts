import { INBOX_DIR } from "../memory/brain-vault-paths.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { logger } from "../utils/logger.ts";

const SIDECAR = `${INBOX_DIR}/transcripts/video-spawn-jobs.json`;
const PROCESSED_LOG = `${INBOX_DIR}/transcripts/processed-videos.txt`;

type SpawnEntry = { videoId: string; title: string; spawnedAt: string };

async function loadSidecar(): Promise<Record<string, SpawnEntry>> {
  try {
    return JSON.parse(await Bun.file(SIDECAR).text()) as Record<string, SpawnEntry>;
  } catch {
    return {};
  }
}

async function saveSidecar(data: Record<string, SpawnEntry>): Promise<void> {
  await Bun.write(SIDECAR, JSON.stringify(data, null, 2));
}

export async function getInFlightVideoIds(): Promise<Set<string>> {
  const data = await loadSidecar();
  return new Set(Object.values(data).map((e) => e.videoId));
}

export async function trackVideoSpawn(
  jobId: string,
  videoId: string,
  title: string,
): Promise<void> {
  const data = await loadSidecar();
  data[jobId] = { videoId, title, spawnedAt: new Date().toISOString() };
  await saveSidecar(data);
}

async function markCompleted(videoId: string, title: string): Promise<void> {
  const entry = `${videoId}|${title}|${new Date().toISOString()}\n`;
  const existing = await Bun.file(PROCESSED_LOG).text().catch(() => "");
  await Bun.write(PROCESSED_LOG, existing + entry);
  try {
    if (memoryEnabled) {
      await getSupabase()
        .from("facts")
        .upsert(
          { category: "processed-video", content: videoId, active: true },
          { onConflict: "category,content" },
        );
    }
  } catch {
    logger.warn("video-tracker:supabase-write-failed", { videoId });
  }
}

/**
 * Called from poll.ts on job completion.
 * On success: writes to processed-videos.txt (permanent).
 * On failure: removes from sidecar — video becomes retry-eligible on next poll cycle.
 */
export async function finalizeVideoJob(
  jobId: string,
  succeeded: boolean,
): Promise<void> {
  const data = await loadSidecar();
  const entry = data[jobId];
  if (!entry) return;

  delete data[jobId];
  await saveSidecar(data);

  if (succeeded) {
    await markCompleted(entry.videoId, entry.title);
    logger.info("video-tracker:completed", {
      videoId: entry.videoId,
      title: entry.title,
    });
  } else {
    logger.info("video-tracker:failed-retry-eligible", {
      videoId: entry.videoId,
      jobId,
    });
  }
}

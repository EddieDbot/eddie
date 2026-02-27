import { config } from "../config.ts";
import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { getTranscriptDir } from "../memory/brain-vault-paths.ts";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

function guessProject(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("shur") || lower.includes("client")) return "shur";
  if (lower.includes("eddie") || lower.includes("homelab")) return "eddie";
  return "general";
}

async function isProcessed(meetingId: string): Promise<boolean> {
  if (!memoryEnabled) return false;
  try {
    const { data } = await getSupabase()
      .from("comms_sync_state")
      .select("id")
      .eq("channel", "meet-transcripts")
      .eq("external_id", meetingId)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function markProcessed(meetingId: string, title: string): Promise<void> {
  if (!memoryEnabled) return;
  try {
    await getSupabase()
      .from("comms_sync_state")
      .upsert(
        {
          channel: "meet-transcripts",
          external_id: meetingId,
          metadata: { title },
        },
        { onConflict: "channel,external_id" },
      );
  } catch {}
}

export async function getNewTranscripts(): Promise<unknown[]> {
  try {
    const { fetchMeetTranscripts } = await import("../comms/google/meet.ts");
    return await fetchMeetTranscripts(config.EDDIE_OWNER_EMAIL);
  } catch {
    return [];
  }
}

export async function storeTranscript(
  meetingId: string,
  title: string,
  content: string,
  date: string,
): Promise<string> {
  const project = guessProject(title);
  const slug = slugify(title);
  const dir = getTranscriptDir(project);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${date}-${slug}.md`);
  await Bun.write(
    path,
    `# ${title}\n\n**Date:** ${date}\n**Meeting ID:** ${meetingId}\n\n---\n\n${content}`,
  );
  return path;
}

export async function runMeetIngestion(): Promise<number> {
  const transcripts = await getNewTranscripts();
  let count = 0;

  for (const transcript of transcripts as any[]) {
    try {
      const id = transcript.externalId ?? transcript.id ?? String(count);
      const already = await isProcessed(id);
      if (already) continue;

      const title = transcript.subject ?? `Meeting ${id}`;
      const date = (transcript.receivedAt ?? new Date().toISOString()).slice(
        0,
        10,
      );

      let content = transcript.preview ?? "";
      if (!content && transcript.metadata?.driveId) {
        try {
          const { getDriveFileContent } =
            await import("../comms/google/drive.ts");
          content = await getDriveFileContent(transcript.metadata.driveId);
        } catch {}
      }

      if (!content) continue;

      await storeTranscript(id, title, content, date);
      await markProcessed(id, title);
      count++;
      logger.info("meet-ingest:stored", { id, title, date });
    } catch (err) {
      logger.warn("meet-ingest:skip", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return count;
}

export function startMeetIngestionCron(): void {
  const ingestTime = (config as any).MEET_INGEST_TIME ?? "21:00";
  const [targetHour, targetMin] = ingestTime.split(":").map(Number);

  function scheduleNext(): void {
    const now = new Date();
    const next = new Date();
    next.setHours(targetHour!, targetMin!, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    setTimeout(async () => {
      try {
        const count = await runMeetIngestion();
        logger.info("meet-ingest:cron-complete", { count });
      } catch (err) {
        logger.error("meet-ingest:cron-error", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      scheduleNext();
    }, delay);
  }

  logger.info("meet-ingest:cron-scheduled", { time: ingestTime });
  scheduleNext();
}

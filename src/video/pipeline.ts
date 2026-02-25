import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { gatherAINews, pickTopStory, markStoryUsed } from "./news-gatherer.ts";
import { generateNewsShortScript, saveScript } from "./script-generator.ts";
import { synthesize } from "../voice/tts.ts";
import { renderVideo } from "./renderer.ts";
import { mixAudioVideo } from "./mixer.ts";
import { uploadVideo } from "./uploader.ts";
import { mkdir } from "node:fs/promises";

const RENDERS_DIR = "/home/na/eddie/data/renders";

async function createRenderRecord(
  storyId: string,
  headline: string,
): Promise<string | null> {
  if (!memoryEnabled) return null;

  const id = crypto.randomUUID();
  const { error } = await getSupabase().from("video_renders").insert({
    id,
    story_id: storyId,
    headline,
    status: "pending",
  });

  if (error) {
    logger.error("pipeline:create-render-record", { error: error.message });
    return null;
  }
  return id;
}

async function updateRenderStatus(
  renderId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!memoryEnabled) return;
  const { error } = await getSupabase()
    .from("video_renders")
    .update({ status, ...extra })
    .eq("id", renderId);
  if (error) {
    logger.error("pipeline:update-render-status", {
      renderId,
      status,
      error: error.message,
    });
  }
}

export async function runDailyShortPipeline(): Promise<{
  youtubeUrl: string;
} | null> {
  logger.info("pipeline:start");
  await mkdir(RENDERS_DIR, { recursive: true });

  // Step 1: Gather fresh news
  const newStories = await gatherAINews();
  logger.info("pipeline:gathered", { newStories });

  // Step 2: Pick top unused story
  const story = await pickTopStory();
  if (!story) {
    logger.warn("pipeline:no-story", { reason: "no unused stories available" });
    return null;
  }
  logger.info("pipeline:story-picked", {
    storyId: story.id,
    headline: story.headline,
  });

  // Step 3: Create render record for tracking
  const renderId = await createRenderRecord(story.id, story.headline);
  if (!renderId) {
    logger.error("pipeline:render-record-failed");
    return null;
  }

  try {
    await updateRenderStatus(renderId, "scripting");

    // Step 4: Generate script
    const script = await generateNewsShortScript(story);
    if (!script) {
      await updateRenderStatus(renderId, "failed", {
        error_message: "Script generation failed",
      });
      return null;
    }
    await saveScript(renderId, script);
    logger.info("pipeline:script-done", { renderId, title: script.title });

    await updateRenderStatus(renderId, "voiceover");

    // Step 5: Synthesize voiceover
    const voiceText = [
      script.hook,
      ...script.sections.map((s) => s.text),
      script.cta,
    ].join(" ");

    const voicePath = `${RENDERS_DIR}/${renderId}-voice.mp3`;
    try {
      const audioBuffer = await synthesize(voiceText);
      await Bun.write(voicePath, audioBuffer);
      logger.info("pipeline:voiceover-done", { renderId, voicePath });
    } catch (err) {
      // Voiceover is non-fatal for Phase 1 — continue without it
      logger.warn("pipeline:voiceover-failed", {
        renderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await updateRenderStatus(renderId, "rendering");

    // Step 6: Render video via Remotion (visuals only, no audio)
    const silentPath = `${RENDERS_DIR}/${renderId}-silent.mp4`;
    const renderResult = await renderVideo({
      composition: "NewsShort",
      props: {
        hook: script.hook,
        sections: script.sections,
        cta: script.cta,
        title: script.title,
        source: story.source,
      },
      outputPath: silentPath,
    });
    logger.info("pipeline:render-done", {
      renderId,
      fileSizeMb: renderResult.fileSizeMb.toFixed(2),
      durationSec: renderResult.durationSec,
    });

    // Step 6b: Mix audio + video if voiceover was generated
    const finalPath = `${RENDERS_DIR}/${renderId}.mp4`;
    const voiceFile = Bun.file(voicePath);
    const hasVoice = await voiceFile.exists();

    if (hasVoice) {
      await mixAudioVideo(silentPath, voicePath, finalPath);
      logger.info("pipeline:mix-done", { renderId });
    } else {
      // No voiceover — use the silent render as final
      await Bun.write(finalPath, Bun.file(silentPath));
    }

    await updateRenderStatus(renderId, "uploading");

    // Step 7: Upload to YouTube
    const uploadResult = await uploadVideo({
      videoPath: finalPath,
      title: script.title,
      description: script.description,
      tags: script.tags,
      privacyStatus: "public",
    });
    logger.info("pipeline:upload-done", {
      renderId,
      youtubeUrl: uploadResult.url,
    });

    // Step 8: Mark story used and update render record
    await markStoryUsed(story.id, renderId);
    await updateRenderStatus(renderId, "done", {
      youtube_url: uploadResult.url,
      youtube_video_id: uploadResult.videoId,
      completed_at: new Date().toISOString(),
    });

    logger.info("pipeline:complete", {
      renderId,
      youtubeUrl: uploadResult.url,
    });
    return { youtubeUrl: uploadResult.url };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("pipeline:failed", { renderId, error: errorMessage });
    await updateRenderStatus(renderId, "failed", {
      error_message: errorMessage,
    });
    return null;
  }
}

export async function refreshNews(): Promise<number> {
  return gatherAINews();
}

export async function getPipelineStatus(): Promise<
  Array<{
    id: string;
    headline: string;
    status: string;
    youtubeUrl: string | null;
    createdAt: string;
  }>
> {
  if (!memoryEnabled) return [];

  const { data, error } = await getSupabase()
    .from("video_renders")
    .select("id, headline, status, youtube_url, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    logger.error("pipeline:status-query", { error: error.message });
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    headline: row.headline as string,
    status: row.status as string,
    youtubeUrl: (row.youtube_url as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hour: h ?? 13, minute: m ?? 0 };
}

function msUntilTime(hour: number, minute: number, timezone: string): number {
  const now = new Date();
  const nowLocal = new Date(
    now.toLocaleString("en-US", { timeZone: timezone }),
  );
  const target = new Date(nowLocal);
  target.setHours(hour, minute, 0, 0);
  if (target <= nowLocal) target.setDate(target.getDate() + 1);
  return target.getTime() - nowLocal.getTime();
}

export function startVideoPipelineScheduler(): void {
  const { hour, minute } = parseTime(config.VIDEO_PIPELINE_TIME);
  const delay = msUntilTime(hour, minute, config.TIMEZONE);
  logger.info("video-pipeline:scheduled", {
    time: config.VIDEO_PIPELINE_TIME,
    delayMs: delay,
  });

  const runAndReschedule = (): void => {
    runDailyShortPipeline()
      .then((result) => {
        if (result) {
          logger.info("video-pipeline:scheduled-run-done", {
            youtubeUrl: result.youtubeUrl,
          });
        } else {
          logger.warn("video-pipeline:scheduled-run-null");
        }
      })
      .catch((err) => {
        logger.error("video-pipeline:scheduled-run-error", {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        const nextDelay = msUntilTime(hour, minute, config.TIMEZONE);
        setTimeout(runAndReschedule, nextDelay);
      });
  };

  setTimeout(runAndReschedule, delay);
}

// CLI entrypoint
if (import.meta.main) {
  const arg = process.argv[2];
  if (arg === "status") {
    const rows = await getPipelineStatus();
    if (rows.length === 0) {
      console.log("No renders yet.");
    } else {
      for (const r of rows) {
        console.log(`[${r.status}] ${r.id} — ${r.headline}`);
        if (r.youtubeUrl) console.log(`  URL: ${r.youtubeUrl}`);
      }
    }
  } else if (arg === "refresh") {
    const count = await refreshNews();
    console.log(`Gathered ${count} new stories.`);
  } else {
    console.log("Running daily short pipeline...");
    const result = await runDailyShortPipeline();
    if (result) {
      console.log(`Done. YouTube URL: ${result.youtubeUrl}`);
    } else {
      console.log("Pipeline returned null — check logs.");
      process.exit(1);
    }
  }
}

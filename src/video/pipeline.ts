import { logger } from "../utils/logger.ts";
import { config } from "../config.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { gatherAINews, pickTopStory, markStoryUsed } from "./news-gatherer.ts";
import {
  generateNewsShortScript,
  saveScript,
  regenerateScript,
} from "./script-generator.ts";
import { synthesize } from "../voice/tts.ts";
import { renderVideo } from "./renderer.ts";
import { mixAudioVideo } from "./mixer.ts";
import { uploadVideo } from "./uploader.ts";
import { mkdir } from "node:fs/promises";
import { runVideoQA, logQAResult } from "./qa-gate.ts";
import { appendVideoEntry } from "./working-doc.ts";
import { scheduleAnalyticsPull } from "./analytics-tracker.ts";
import { createPipelineTracker } from "./pipeline-tracker.ts";

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

  const pipelineStart = Date.now();
  const tracker = createPipelineTracker(renderId);

  try {
    await updateRenderStatus(renderId, "scripting", {
      started_at: new Date().toISOString(),
    });

    // Step 4: Generate script
    const scriptStep = tracker.startStep("scripting");
    let script = await generateNewsShortScript(story);
    if (!script) {
      await updateRenderStatus(renderId, "failed", {
        error_message: "Script generation failed",
      });
      return null;
    }
    await saveScript(renderId, script);
    logger.info("pipeline:script-done", { renderId, title: script.title });

    const voiceText = [
      script.hook,
      script.foreshadow,
      ...script.body,
      script.payoff,
    ].join(" ");

    await scriptStep.done(true, {
      title: script.title,
      emotionTarget: script.emotionTarget,
      estimatedRuntimeSec: script.estimatedRuntimeSec,
      bodyCount: script.body.length,
      nodeLength: script.node.length,
      voiceCharCount: voiceText.length,
    });

    await updateRenderStatus(renderId, "voiceover");

    // Step 5: Synthesize voiceover
    const voiceStep = tracker.startStep("voiceover");
    const voicePath = `${RENDERS_DIR}/${renderId}-voice.mp3`;
    try {
      const audioBuffer = await synthesize(voiceText);
      await Bun.write(voicePath, audioBuffer);
      logger.info("pipeline:voiceover-done", { renderId, voicePath });
      const voiceSize = await Bun.file(voicePath).size;
      await voiceStep.done(true, {
        charCount: voiceText.length,
        fileSizeBytes: voiceSize,
      });
    } catch (err) {
      // Voiceover is non-fatal for Phase 1 — continue without it
      await voiceStep.done(
        false,
        {},
        err instanceof Error ? err.message : String(err),
      );
      logger.warn("pipeline:voiceover-failed", {
        renderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await updateRenderStatus(renderId, "rendering");

    // Step 6: Render video via Remotion (visuals only, no audio)
    const renderStep = tracker.startStep("rendering");
    const silentPath = `${RENDERS_DIR}/${renderId}-silent.mp4`;
    const renderResult = await renderVideo({
      composition: "NewsShort",
      props: {
        hook: script.hook,
        foreshadow: script.foreshadow,
        body: script.body,
        payoff: script.payoff,
        title: script.title,
        source: story.source,
        emotionTarget: script.emotionTarget,
      },
      outputPath: silentPath,
    });
    logger.info("pipeline:render-done", {
      renderId,
      fileSizeMb: renderResult.fileSizeMb.toFixed(2),
      durationSec: renderResult.durationSec,
    });
    await renderStep.done(true, {
      fileSizeMb: renderResult.fileSizeMb,
      durationSec: renderResult.durationSec,
      fileSizeBytes: Math.round(renderResult.fileSizeMb * 1024 * 1024),
    });

    // Step 6b: Mix audio + video if voiceover was generated
    const finalPath = `${RENDERS_DIR}/${renderId}.mp4`;
    const voiceFile = Bun.file(voicePath);
    const hasVoice = await voiceFile.exists();

    if (hasVoice) {
      const mixStep = tracker.startStep("mixing");
      await mixAudioVideo(silentPath, voicePath, finalPath);
      logger.info("pipeline:mix-done", { renderId });
      const finalSize = await Bun.file(finalPath).size;
      await mixStep.done(true, { fileSizeBytes: finalSize });
    } else {
      // No voiceover — use the silent render as final
      await Bun.write(finalPath, Bun.file(silentPath));
    }

    // QA gate loop
    let finalVideoPath = finalPath;
    let qaResult: {
      pass: boolean;
      attempt: number;
      durationMs: number;
      issues: string[];
      fixInstructions: string[];
    } | null = null;
    let qaAttempts = 0;

    if (config.VIDEO_QA_ENABLED) {
      for (
        let attempt = 1;
        attempt <= config.VIDEO_QA_MAX_ATTEMPTS;
        attempt++
      ) {
        qaAttempts = attempt;
        await updateRenderStatus(renderId, `qa-attempt-${attempt}`);
        const qa = await runVideoQA(finalVideoPath, script, attempt);
        await logQAResult(renderId, qa);
        qaResult = qa;

        await tracker.startStep(`qa-attempt-${attempt}`).done(
          qa.pass,
          {
            durationMs: qa.durationMs,
            issueCount: qa.issues.length,
            issues: qa.issues,
            durationSec: qa.durationSec,
          },
          qa.pass ? undefined : qa.issues.join("; "),
        );

        if (qa.pass) {
          logger.info("pipeline:qa-passed", { renderId, attempt });
          break;
        }

        logger.warn("pipeline:qa-failed", {
          renderId,
          attempt,
          issues: qa.issues,
        });

        if (attempt < config.VIDEO_QA_MAX_ATTEMPTS) {
          const revisedScript = await regenerateScript(
            script,
            qa.fixInstructions,
          );
          if (revisedScript) {
            script = revisedScript;
            await saveScript(renderId, script);

            // Re-synthesize voice
            const revisedVoiceText = [
              script.hook,
              script.foreshadow,
              ...script.body,
              script.payoff,
            ].join(" ");
            const revisedVoicePath = `${RENDERS_DIR}/${renderId}-voice-${attempt}.mp3`;
            try {
              const audioBuffer = await synthesize(revisedVoiceText);
              await Bun.write(revisedVoicePath, audioBuffer);
            } catch (err) {
              logger.warn("pipeline:qa-revoice-failed", {
                attempt,
                error: String(err),
              });
            }

            // Re-render
            const revisedSilentPath = `${RENDERS_DIR}/${renderId}-silent-${attempt}.mp4`;
            await renderVideo({
              composition: "NewsShort",
              props: {
                hook: script.hook,
                foreshadow: script.foreshadow,
                body: script.body,
                payoff: script.payoff,
                title: script.title,
                source: story.source,
                emotionTarget: script.emotionTarget,
              },
              outputPath: revisedSilentPath,
            });

            // Re-mix
            const revisedFinalPath = `${RENDERS_DIR}/${renderId}-qa${attempt}.mp4`;
            const revisedVoiceFile = Bun.file(revisedVoicePath);
            if (await revisedVoiceFile.exists()) {
              await mixAudioVideo(
                revisedSilentPath,
                revisedVoicePath,
                revisedFinalPath,
              );
            } else {
              await Bun.write(revisedFinalPath, Bun.file(revisedSilentPath));
            }
            finalVideoPath = revisedFinalPath;
          }
        } else {
          logger.warn("pipeline:qa-max-attempts", {
            renderId,
            posting: "anyway",
          });
        }
      }
    }

    await updateRenderStatus(renderId, "uploading");

    // Step 7: Upload to YouTube
    const uploadStep = tracker.startStep("uploading");
    const uploadResult = await uploadVideo({
      videoPath: finalVideoPath,
      title: script.title,
      description: script.description,
      tags: script.tags,
      privacyStatus: "public",
    });
    logger.info("pipeline:upload-done", {
      renderId,
      youtubeUrl: uploadResult.url,
    });
    await uploadStep.done(true, {
      videoId: uploadResult.videoId,
      url: uploadResult.url,
    });

    // Step 8: Mark story used and update render record
    await markStoryUsed(story.id, renderId);
    await updateRenderStatus(renderId, "done", {
      youtube_url: uploadResult.url,
      youtube_video_id: uploadResult.videoId,
      completed_at: new Date().toISOString(),
    });

    // Append to working doc
    await appendVideoEntry({
      renderId,
      headline: story.headline,
      hook: script.hook,
      emotionTarget: script.emotionTarget,
      node: script.node,
      qaAttempts,
      qaIssues: qaResult?.issues ?? [],
      qaFinalPass: qaResult?.pass ?? true,
      youtubeUrl: uploadResult.url,
      youtubeVideoId: uploadResult.videoId,
      postedAt: new Date().toISOString(),
    });

    const finalFileSize = await Bun.file(finalVideoPath).size;
    await tracker.finish({
      totalDurationMs: Date.now() - pipelineStart,
      emotionTarget: script.emotionTarget,
      nodeText: script.node,
      estimatedRuntimeSec: script.estimatedRuntimeSec,
      voiceCharCount: voiceText.length,
      finalFileSizeBytes: finalFileSize,
      qaAttemptsTotal: qaAttempts,
      qaFinalPass: qaResult?.pass ?? true,
      scriptPrompt: `Headline: ${story.headline}\nSource: ${story.source}${story.summary ? `\nSummary: ${story.summary}` : ""}`,
    });

    // Schedule analytics pulls (48h + 7 days) if enabled
    if (config.VIDEO_ANALYTICS_ENABLED) {
      scheduleAnalyticsPull(
        uploadResult.videoId,
        renderId,
        story.headline,
        new Date(),
      );
    }

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
    await tracker
      .finish({
        totalDurationMs: Date.now() - pipelineStart,
        failedStep: "unknown",
      })
      .catch(() => {}); // don't let tracker errors mask the real error
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

function getScheduledTimes(): Array<{
  hour: number;
  minute: number;
  label: string;
}> {
  const raw = config.VIDEO_PIPELINE_TIMES.trim();
  const timeStrings = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [config.VIDEO_PIPELINE_TIME];
  return timeStrings.map((t) => ({ ...parseTime(t), label: t }));
}

function scheduleSlot(slot: {
  hour: number;
  minute: number;
  label: string;
}): void {
  const delay = msUntilTime(slot.hour, slot.minute, config.TIMEZONE);
  logger.info("video-pipeline:slot-scheduled", {
    time: slot.label,
    delayMs: delay,
  });

  const run = (): void => {
    runDailyShortPipeline()
      .then((result) => {
        if (result) {
          logger.info("video-pipeline:slot-done", {
            time: slot.label,
            youtubeUrl: result.youtubeUrl,
          });
        } else {
          logger.warn("video-pipeline:slot-null", { time: slot.label });
        }
      })
      .catch((err) => {
        logger.error("video-pipeline:slot-error", {
          time: slot.label,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        const nextDelay = msUntilTime(slot.hour, slot.minute, config.TIMEZONE);
        setTimeout(run, nextDelay);
      });
  };

  setTimeout(run, delay);
}

export function startVideoPipelineScheduler(): void {
  const slots = getScheduledTimes();
  logger.info("video-pipeline:scheduler-start", {
    slots: slots.map((s) => s.label),
    count: slots.length,
  });
  for (const slot of slots) {
    scheduleSlot(slot);
  }
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

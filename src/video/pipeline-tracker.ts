import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";

type StepHandle = {
  done(
    success: boolean,
    metadata?: Record<string, unknown>,
    errorMsg?: string
  ): Promise<void>;
};

type FinishSummary = {
  totalDurationMs: number;
  failedStep?: string;
  emotionTarget?: string;
  nodeText?: string;
  estimatedRuntimeSec?: number;
  actualDurationSec?: number;
  voiceCharCount?: number;
  voiceFileSizeBytes?: number;
  renderFileSizeBytes?: number;
  finalFileSizeBytes?: number;
  qaAttemptsTotal?: number;
  qaFinalPass?: boolean;
  scriptPrompt?: string;
};

export type PipelineTracker = {
  startStep(step: string): StepHandle;
  finish(summary: FinishSummary): Promise<void>;
};

export function createPipelineTracker(renderId: string): PipelineTracker {
  return {
    startStep(step: string): StepHandle {
      const startedAt = new Date();

      return {
        async done(success, metadata = {}, errorMsg) {
          const completedAt = new Date();
          const durationMs = completedAt.getTime() - startedAt.getTime();

          logger.info("pipeline-tracker:step", {
            renderId,
            step,
            success,
            durationMs,
          });

          if (!memoryEnabled) return;

          const { error } = await getSupabase()
            .from("video_pipeline_steps")
            .insert({
              render_id: renderId,
              step,
              started_at: startedAt.toISOString(),
              completed_at: completedAt.toISOString(),
              duration_ms: durationMs,
              success,
              error_message: errorMsg ?? null,
              metadata: Object.keys(metadata).length > 0 ? metadata : null,
            });

          if (error) {
            logger.error("pipeline-tracker:write-error", {
              renderId,
              step,
              error: error.message,
            });
          }
        },
      };
    },

    async finish(summary: FinishSummary): Promise<void> {
      if (!memoryEnabled) return;

      const { error } = await getSupabase()
        .from("video_renders")
        .update({
          total_duration_ms: summary.totalDurationMs,
          failed_step: summary.failedStep ?? null,
          emotion_target: summary.emotionTarget ?? null,
          node_text: summary.nodeText ?? null,
          estimated_runtime_sec: summary.estimatedRuntimeSec ?? null,
          actual_duration_sec: summary.actualDurationSec ?? null,
          voice_char_count: summary.voiceCharCount ?? null,
          voice_file_size_bytes: summary.voiceFileSizeBytes ?? null,
          render_file_size_bytes: summary.renderFileSizeBytes ?? null,
          final_file_size_bytes: summary.finalFileSizeBytes ?? null,
          qa_attempts_total: summary.qaAttemptsTotal ?? null,
          qa_final_pass: summary.qaFinalPass ?? null,
          script_prompt: summary.scriptPrompt ?? null,
        })
        .eq("id", renderId);

      if (error) {
        logger.error("pipeline-tracker:finish-error", {
          renderId,
          error: error.message,
        });
      }
    },
  };
}

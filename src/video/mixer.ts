import { logger } from "../utils/logger.ts";

export type MixResult = {
  outputPath: string;
  fileSizeMb: number;
};

/**
 * Mix a silent video with a voiceover audio track using FFmpeg.
 * Output is a new MP4 at outputPath.
 */
export async function mixAudioVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<MixResult> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ac",
      "2",
      "-ar",
      "44100",
      outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [exitCode] = await Promise.all([proc.exited]);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `FFmpeg mix failed (exit ${exitCode}): ${stderr.slice(-500)}`,
    );
  }

  const file = Bun.file(outputPath);
  const fileSizeMb = file.size / (1024 * 1024);

  logger.info("mixer:done", { outputPath, fileSizeMb: fileSizeMb.toFixed(2) });
  return { outputPath, fileSizeMb };
}

/**
 * Trim a video to a max duration using FFmpeg (for enforcing Shorts limit).
 */
export async function trimVideo(
  inputPath: string,
  outputPath: string,
  maxDurationSec: number,
): Promise<void> {
  const proc = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-i",
      inputPath,
      "-t",
      String(maxDurationSec),
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      outputPath,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [exitCode] = await Promise.all([proc.exited]);
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `FFmpeg trim failed (exit ${exitCode}): ${stderr.slice(-500)}`,
    );
  }
}

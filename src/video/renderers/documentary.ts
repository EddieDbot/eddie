import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { logger } from "../../utils/logger.ts";
import { config } from "../../config.ts";

const execFileAsync = promisify(execFile);

export type DocumentaryScene = {
  imagePrompt: string;
  caption?: string;
  durationSec: number;
};

export type DocumentaryRenderParams = {
  renderId: string;
  scenes: DocumentaryScene[];
  voicePath: string;
  outputPath: string;
  accentColor?: string;
};

const PORTRAIT_PREFIX = "Vertical 9:16 portrait format. ";
const IMAGEN_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict";

async function generateSceneImage(
  prompt: string,
  outPath: string,
): Promise<void> {
  const url = `${IMAGEN_ENDPOINT}?key=${config.GOOGLE_API_KEY}`;
  const body = {
    instances: [{ prompt: `${PORTRAIT_PREFIX}${prompt}` }],
    parameters: { sampleCount: 1, aspectRatio: "9:16" },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Imagen API error ${resp.status}: ${text.slice(0, 300)}`);
  }

  const json = (await resp.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string }>;
  };
  const b64 = json.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    throw new Error(
      `Imagen returned no image data. Response: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }

  const bytes = Buffer.from(b64, "base64");
  await writeFile(outPath, bytes);
}

function buildKenBurnsFilter(
  scenePaths: string[],
  scenes: DocumentaryScene[],
  accentColor: string,
): { filterComplex: string; inputArgs: string[] } {
  const fps = 30;
  const inputArgs: string[] = [];
  const filterParts: string[] = [];

  for (const p of scenePaths) {
    inputArgs.push("-i", p);
  }

  // Build zoompan filter for each scene
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const frames = Math.ceil(scene.durationSec * fps);
    const zoomIn = i % 2 === 0;

    const zoom = zoomIn
      ? `zoom='min(zoom+0.0015,1.5)'`
      : `zoom='if(lte(zoom,1.0),1.5,zoom-0.0015)'`;
    const x = zoomIn
      ? `x='if(gte(zoom,1.5),x,x+0.5)'`
      : `x='if(lte(zoom,1.0),x,x-0.5)'`;
    const y = zoomIn
      ? `y='if(gte(zoom,1.5),y,y+0.5)'`
      : `y='if(lte(zoom,1.0),y,y-0.5)'`;

    const kbFilter = `[${i}:v]scale=1920:1920:force_original_aspect_ratio=increase,crop=1080:1920,zoompan=${zoom}:${x}:${y}:d=${frames}:s=1080x1920:fps=${fps}[kb${i}]`;
    filterParts.push(kbFilter);
  }

  // Add caption/drawtext if needed
  const captionedLabels: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    const inputLabel = `[kb${i}]`;
    const outputLabel = `[sc${i}]`;

    if (scene.caption) {
      const safeCaption = scene.caption.replace(/[\\':]/g, "\\$&");
      const drawtext =
        `${inputLabel}drawtext=` +
        `text='${safeCaption}':` +
        `fontcolor=white:` +
        `fontsize=52:` +
        `x=(w-text_w)/2:` +
        `y=h-text_h-120:` +
        `box=1:boxcolor=black@0.55:boxborderw=18` +
        `${outputLabel}`;
      filterParts.push(drawtext);
      captionedLabels.push(outputLabel);
    } else {
      captionedLabels.push(inputLabel);
    }
  }

  // Chain xfade crossfades
  const crossfadeDuration = 0.5;
  let lastLabel = captionedLabels[0]!;
  let cumulativeOffset = 0;

  for (let i = 1; i < scenes.length; i++) {
    cumulativeOffset += scenes[i - 1]!.durationSec - crossfadeDuration;
    const nextLabel = captionedLabels[i]!;
    const outLabel = i === scenes.length - 1 ? "[vout]" : `[xf${i}]`;
    filterParts.push(
      `${lastLabel}${nextLabel}xfade=transition=fade:duration=${crossfadeDuration}:offset=${cumulativeOffset.toFixed(3)}${outLabel}`,
    );
    lastLabel = outLabel;
  }

  // If only one scene, rename for consistent final label
  if (scenes.length === 1) {
    filterParts.push(`${lastLabel}copy[vout]`);
  }

  return { filterComplex: filterParts.join("; "), inputArgs };
}

export async function renderDocumentary(
  params: DocumentaryRenderParams,
): Promise<string> {
  const { renderId, scenes, voicePath, outputPath, accentColor = "#00D4FF" } =
    params;

  if (scenes.length === 0) throw new Error("documentary: no scenes provided");

  const tmpDir = `/tmp/documentary-${renderId}`;
  await mkdir(tmpDir, { recursive: true });

  logger.info("documentary:start", { renderId, sceneCount: scenes.length });

  // Step 1: Generate images in parallel
  const scenePaths = scenes.map((_, i) => `${tmpDir}/scene-${i}.png`);

  logger.info("documentary:imagen-start", { renderId, count: scenes.length });
  await Promise.all(
    scenes.map((scene, i) => {
      logger.info("documentary:imagen-scene", {
        renderId,
        index: i,
        promptSnippet: scene.imagePrompt.slice(0, 60),
      });
      return generateSceneImage(scene.imagePrompt, scenePaths[i]!);
    }),
  );
  logger.info("documentary:imagen-done", { renderId });

  // Step 2: Build filter complex
  const { filterComplex, inputArgs } = buildKenBurnsFilter(
    scenePaths,
    scenes,
    accentColor,
  );

  // Step 3: Build silent video
  const silentPath = `${tmpDir}/silent.mp4`;
  const ffmpegArgs = [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    silentPath,
  ];

  logger.info("documentary:ffmpeg-render", { renderId });
  try {
    await execFileAsync("ffmpeg", ffmpegArgs);
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as NodeJS.ErrnoException & { stderr: string }).stderr)
        : String(err);
    throw new Error(
      `documentary ffmpeg render failed: ${stderr.slice(-1000)}`,
    );
  }

  // Step 4: Mix voiceover
  logger.info("documentary:mix-start", { renderId });
  const mixArgs = [
    "-y",
    "-i",
    silentPath,
    "-i",
    voicePath,
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
  ];

  try {
    await execFileAsync("ffmpeg", mixArgs);
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as NodeJS.ErrnoException & { stderr: string }).stderr)
        : String(err);
    throw new Error(`documentary ffmpeg mix failed: ${stderr.slice(-1000)}`);
  }

  logger.info("documentary:mix-done", { renderId, outputPath });

  // Step 5: Cleanup temp dir
  await rm(tmpDir, { recursive: true, force: true });
  logger.info("documentary:cleanup-done", { renderId });

  return outputPath;
}

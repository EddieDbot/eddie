import { logger } from "../utils/logger.ts";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const REMOTION_DIR = "/home/na/eddie/remotion";
const RENDERS_DIR = "/home/na/eddie/data/renders";
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;

export type RenderParams = {
  composition: string;
  props: Record<string, unknown>;
  outputPath: string;
};

export type RenderResult = {
  outputPath: string;
  durationSec: number;
  fileSizeMb: number;
};

export async function renderVideo(params: RenderParams): Promise<RenderResult> {
  await mkdir(RENDERS_DIR, { recursive: true });

  const { composition, props, outputPath } = params;
  const propsJson = JSON.stringify(props);

  const args = [
    "remotion",
    "render",
    "src/Root.tsx",
    composition,
    outputPath,
    `--props=${propsJson}`,
  ];

  logger.info("renderer:start", {
    composition,
    outputPath,
    propsKeys: Object.keys(props),
  });

  const proc = Bun.spawn(["npx", ...args], {
    cwd: REMOTION_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutId = setTimeout(() => {
    proc.kill();
    logger.error("renderer:timeout", { composition, outputPath });
  }, RENDER_TIMEOUT_MS);

  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    logger.error("renderer:failed", {
      composition,
      exitCode,
      stderr: stderr.slice(0, 500),
    });
    throw new Error(
      `Remotion render failed (exit ${exitCode}): ${stderr.slice(0, 300)}`,
    );
  }

  const file = Bun.file(outputPath);
  if (!(await file.exists())) {
    throw new Error(
      `Render completed but output file not found: ${outputPath}`,
    );
  }

  const fileSizeBytes = file.size;
  const fileSizeMb = fileSizeBytes / (1024 * 1024);

  // Extract duration from props if available, otherwise estimate from script
  const totalDurationSec =
    typeof props.totalDurationSec === "number"
      ? props.totalDurationSec
      : typeof props.script === "object" &&
          props.script !== null &&
          typeof (props.script as Record<string, unknown>).totalDurationSec ===
            "number"
        ? ((props.script as Record<string, unknown>).totalDurationSec as number)
        : 60;

  logger.info("renderer:done", {
    composition,
    outputPath,
    fileSizeMb: fileSizeMb.toFixed(2),
    durationSec: totalDurationSec,
  });

  return {
    outputPath,
    durationSec: totalDurationSec,
    fileSizeMb,
  };
}

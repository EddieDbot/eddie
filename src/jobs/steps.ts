import type { StepError } from "./types.ts";

export function parseStepMarkers(output: string, jobId = ""): StepError[] {
  const errors: StepError[] = [];
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/^STEP_ERROR:(\d+):([^:]+):(.+)$/);
    if (match) {
      errors.push({
        jobId,
        step: parseInt(match[1]!, 10),
        stepName: match[2]!,
        error: match[3]!,
        timestamp: new Date().toISOString(),
      });
    }
  }
  return errors;
}

export function extractLastStepContext(output: string): {
  lastStep: number;
  lastStepName: string;
  reachedEnd: boolean;
} {
  let lastStep = 0;
  let lastStepName = "";
  const reachedEnd = output.includes("STEP_COMPLETE");

  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/^STEP:(\d+):(.+)$/);
    if (match) {
      lastStep = parseInt(match[1]!, 10);
      lastStepName = match[2]!;
    }
  }

  return { lastStep, lastStepName, reachedEnd };
}

export function emitStepError(step: number, name: string, error: string): string {
  return `STEP_ERROR:${step}:${name}:${error}`;
}

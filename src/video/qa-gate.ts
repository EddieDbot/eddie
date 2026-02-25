import { logger } from "../utils/logger.ts";
import { getSupabase, memoryEnabled } from "../memory/client.ts";
import { config } from "../config.ts";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoScript } from "./script-generator.ts";

const execFileAsync = promisify(execFile);

export type QAResult = {
  pass: boolean;
  attempt: number;
  durationSec: number;
  issues: string[];
  fixInstructions: string[];
  rawReport: string;
};

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_streams",
    videoPath,
  ]);
  const info = JSON.parse(stdout);
  const videoStream = info.streams?.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  return parseFloat(videoStream?.duration ?? "0");
}

async function extractFrames(
  videoPath: string,
  durationSec: number,
): Promise<string[]> {
  const tmpDir = "/tmp/qa-frames";
  await execFileAsync("mkdir", ["-p", tmpDir]);

  const timestamps: string[] = [
    "0.5",
    String(Math.floor(durationSec / 2)),
    String(Math.max(0, durationSec - 1.5)),
  ];

  const framePaths: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i] ?? "0";
    const framePath = `${tmpDir}/frame-${Date.now()}-${i}.jpg`;
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      ts,
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-q:v",
      "3",
      framePath,
    ]);
    framePaths.push(framePath);
  }
  return framePaths;
}

async function sendToGemini(
  frames: string[],
  script: VideoScript,
  durationSec: number,
  attempt: number,
): Promise<string> {
  const apiKey = config.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not set");

  const parts: unknown[] = [
    {
      text: `You are a YouTube Shorts QA reviewer. Analyze this video against the QA checklist.

VIDEO SCRIPT:
Hook: ${script.hook}
Foreshadow: ${script.foreshadow}
Body: ${script.body.join(" ")}
Payoff: ${script.payoff}
Emotion target: ${script.emotionTarget}
Node: ${script.node}

VIDEO DURATION: ${durationSec.toFixed(1)}s
QA ATTEMPT: ${attempt}

FRAME 1 = first 0.5s (hook frame)
FRAME 2 = midpoint (body frame)
FRAME 3 = last 1.5s (payoff frame)

Evaluate each item as PASS or FAIL:

UNIVERSAL CHECKS:
- Duration: ${durationSec.toFixed(1)}s — Target 28-34s — ${durationSec >= 28 && durationSec <= 34 ? "PASS" : "FAIL"}
- First 3s: Visual hook legible from first frame
- Audio: Present, voice audible, not clipping
- Captions: Visible throughout
- Ending: Cuts after final line (no dead air)

SCRIPT COMPLIANCE:
- Hook: Opens with consequence/tension, not summary [quote first line]
- Structure: But/Therefore transitions present [flag offenders]
- Mechanism: Viewer has something to track toward
- Payoff: Strong, short final line [quote final line]
- Node: Unique angle communicated

Respond in this exact format:
OVERALL: PASS or FAIL
ISSUES:
1. [issue if any]
FIX INSTRUCTIONS:
1. [specific actionable fix if any]
RAW_REPORT_END`,
    },
  ];

  for (const framePath of frames) {
    const frameData = await readFile(framePath);
    parts.push({
      inlineData: {
        mimeType: "image/jpeg",
        data: frameData.toString("base64"),
      },
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.VIDEO_QA_GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

function parseQAReport(
  rawReport: string,
  durationSec: number,
  attempt: number,
): QAResult {
  const lines = rawReport
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const overallLine = lines.find((l) => l.startsWith("OVERALL:")) ?? "";
  const pass = overallLine.includes("PASS") && !overallLine.includes("FAIL");

  const issues: string[] = [];
  const fixInstructions: string[] = [];

  let inIssues = false;
  let inFixes = false;
  for (const line of lines) {
    if (line.startsWith("ISSUES:")) {
      inIssues = true;
      inFixes = false;
      continue;
    }
    if (line.startsWith("FIX INSTRUCTIONS:")) {
      inFixes = true;
      inIssues = false;
      continue;
    }
    if (line === "RAW_REPORT_END") break;
    const content = line.replace(/^\d+\.\s*/, "").trim();
    if (inIssues && content) issues.push(content);
    if (inFixes && content) fixInstructions.push(content);
  }

  return { pass, attempt, durationSec, issues, fixInstructions, rawReport };
}

export async function runVideoQA(
  videoPath: string,
  script: VideoScript,
  attempt: number,
): Promise<QAResult & { durationMs: number }> {
  const qaStart = Date.now();
  let durationSec = 0;
  try {
    durationSec = await getVideoDuration(videoPath);
  } catch (err) {
    logger.warn("qa-gate:ffprobe-failed", { error: String(err) });
  }

  const frames = await extractFrames(videoPath, durationSec);
  const rawReport = await sendToGemini(frames, script, durationSec, attempt);
  const result = parseQAReport(rawReport, durationSec, attempt);
  const durationMs = Date.now() - qaStart;

  logger.info("qa-gate:result", {
    attempt,
    pass: result.pass,
    durationSec: result.durationSec,
    issueCount: result.issues.length,
    durationMs,
  });

  return { ...result, durationMs };
}

export async function logQAResult(
  renderId: string,
  result: QAResult,
  durationMs?: number,
): Promise<void> {
  if (!memoryEnabled) return;

  const { error } = await getSupabase()
    .from("video_qa_results")
    .insert({
      render_id: renderId,
      attempt: result.attempt,
      pass: result.pass,
      duration_sec: result.durationSec,
      issues: result.issues,
      fix_instructions: result.fixInstructions,
      raw_report: result.rawReport,
      duration_ms: durationMs ?? null,
      gemini_model: config.VIDEO_QA_GEMINI_MODEL,
    });

  if (error) {
    logger.error("qa-gate:log-error", { renderId, error: error.message });
  }
}

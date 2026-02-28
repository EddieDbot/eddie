// SYNC: remotion/src/types/animation-spec.ts
import type { VideoScript } from "./script-generator.ts";

export type ComponentHint = 'glitch' | 'shiny' | 'countup' | 'blur-reveal' | 'standard';

export type AnimationSection = {
  name: string;
  startFrame: number;
  durationFrames: number;
  text: string;
  componentHint?: ComponentHint;
  emphasisWord?: string;
  extractedNumber?: number;
  numberPrefix?: string;
  numberSuffix?: string;
  intraBeats?: Record<string, number>;
};

export type ClosingSpec = {
  lines: string[];
  accentLineIndex: number;
  holdFrames: number;
};

export type AnimationSpec = {
  beats: Record<string, number>;
  totalFrames: number;
  fps: number;
  sections: AnimationSection[];
  colorPalette: { primary: string; accent: string; background: string };
  closing?: ClosingSpec;
};

const WORDS_PER_SEC = 2.8;
const MIN_HOOK_SEC = 2;
const MIN_FORESHADOW_SEC = 1.5;
const MIN_BODY_SEC = 2;
const MIN_PAYOFF_SEC = 1.5;
const TRANSITION_FRAMES = 8;

const KINETIC_PALETTE = {
  primary: "#00D4FF",
  accent: "#7B61FF",
  background: "#050510",
};

const RANKING_PALETTE = {
  primary: "#00D4FF",
  accent: "#FF2D78",
  background: "#070714",
};

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or',
  'but', 'in', 'on', 'at', 'for', 'with', 'that', 'this', 'it', 'its',
  'by', 'from', 'as', 'be', 'been', 'has', 'have', 'had', 'will', 'just',
]);

function estimateSec(text: string, min: number): number {
  return Math.max(min, text.split(/\s+/).length / WORDS_PER_SEC);
}

function getHookHint(text: string): { componentHint: ComponentHint; emphasisWord?: string } {
  const words = text.split(/\s+/);
  const significant = words.filter(
    (w) => !STOPWORDS.has(w.toLowerCase().replace(/[.,!?]$/, ''))
  );
  const emphasisWord = significant[significant.length - 1]?.replace(/[.,!?'"]+$/, '');
  return { componentHint: 'glitch', emphasisWord };
}

function getForeshadowHint(text: string): { componentHint: ComponentHint; emphasisWord?: string } {
  const words = text.split(/\s+/);
  const significant = words.filter(
    (w) => !STOPWORDS.has(w.toLowerCase().replace(/[.,!?]$/, ''))
  );
  // Use the middle significant word as the emphasis (promise/mechanism word)
  const midIdx = Math.floor(significant.length / 2);
  const emphasisWord = significant[midIdx]?.replace(/[.,!?'"]+$/, '');
  return { componentHint: 'shiny', emphasisWord };
}

function getBodyHint(text: string): {
  componentHint: ComponentHint;
  extractedNumber?: number;
  numberPrefix?: string;
  numberSuffix?: string;
} {
  const match = text.match(/(\$)?([\d,]+(?:\.\d+)?)([BMK%])?/);
  if (match) {
    const prefix = match[1] ?? '';
    const raw = (match[2] ?? '').replace(/,/g, '');
    const suffix = match[3] ?? '';
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) {
      return {
        componentHint: 'countup',
        extractedNumber: num,
        numberPrefix: prefix || undefined,
        numberSuffix: suffix || undefined,
      };
    }
  }
  return { componentHint: 'standard' };
}

function hookIntraBeats(sectionFrames: number): Record<string, number> {
  return {
    HOOK_IN: 0,
    HOOK_LABEL_IN: 2,
    HOOK_TEXT_START: 4,
    HOOK_TEXT_MID: Math.floor(sectionFrames * 0.35),
    HOOK_TEXT_END: Math.floor(sectionFrames * 0.65),
    HOOK_DIVIDER_IN: 10,
    HOOK_BORDER_GLOW: 15,
    HOOK_BG_PULSE: Math.floor(sectionFrames * 0.5),
  };
}

function foreshadowIntraBeats(sectionFrames: number): Record<string, number> {
  return {
    FS_IN: 0,
    FS_BADGE_IN: 2,
    FS_TEXT_START: 4,
    FS_TEXT_MID: Math.floor(sectionFrames * 0.4),
    FS_TEXT_END: Math.floor(sectionFrames * 0.7),
    FS_SHINE: Math.floor(sectionFrames * 0.3),
  };
}

function bodyIntraBeats(
  sectionFrames: number,
  index: number,
  hasNumber: boolean,
): Record<string, number> {
  const beats: Record<string, number> = {
    [`BODY_${index}_IN`]: 0,
    [`BODY_${index}_DOTS_IN`]: 2,
    [`BODY_${index}_TEXT_START`]: 4,
    [`BODY_${index}_TEXT_END`]: Math.floor(sectionFrames * 0.6),
  };
  if (hasNumber) {
    beats[`BODY_${index}_BADGE_IN`] = Math.floor(sectionFrames * 0.25);
    beats[`BODY_${index}_COUNTUP_END`] = Math.floor(sectionFrames * 0.55);
  }
  return beats;
}

function payoffIntraBeats(): Record<string, number> {
  return {
    PAYOFF_IN: 0,
    PAYOFF_LINE1_START: 10,
    PAYOFF_LINE2_START: 70,
    PAYOFF_GLOW_PEAK: 85,
    PAYOFF_HOLD_START: 95,
  };
}

export function generateAnimationSpec(
  script: VideoScript,
  style: "kinetic" | "ranking",
  fps = 30,
): AnimationSpec {
  const hookSec = estimateSec(script.hook, MIN_HOOK_SEC);
  const foreshadowSec = estimateSec(script.foreshadow, MIN_FORESHADOW_SEC);
  const bodySecs = script.body.map((s) => estimateSec(s, MIN_BODY_SEC));
  const payoffSec = estimateSec(script.payoff, MIN_PAYOFF_SEC);

  const hookFrames = Math.ceil(hookSec * fps);
  const foreshadowFrames = Math.ceil(foreshadowSec * fps);
  const bodyFrames = bodySecs.map((s) => Math.ceil(s * fps));
  const payoffFrames = Math.ceil(payoffSec * fps);

  const sectionCount = 2 + script.body.length + 1;
  const transitionDeduction = (sectionCount - 1) * TRANSITION_FRAMES;

  // Add closing buffer so ClosingScene has room (breathing + 2 lines + hold)
  const CLOSING_BUFFER = 100;

  const rawTotal =
    hookFrames +
    foreshadowFrames +
    bodyFrames.reduce((a, b) => a + b, 0) +
    payoffFrames +
    CLOSING_BUFFER;
  const totalFrames = Math.max(30, rawTotal - transitionDeduction);

  const sections: AnimationSection[] = [];
  const beats: Record<string, number> = {};

  let cursor = 0;

  // Hook section
  const hookHint = getHookHint(script.hook);
  beats["HOOK_IN"] = cursor;
  sections.push({
    name: "hook",
    startFrame: cursor,
    durationFrames: hookFrames,
    text: script.hook,
    ...hookHint,
    intraBeats: hookIntraBeats(hookFrames),
  });
  cursor += hookFrames - TRANSITION_FRAMES;

  // Foreshadow section
  const fsHint = getForeshadowHint(script.foreshadow);
  beats["FORESHADOW_IN"] = cursor;
  sections.push({
    name: "foreshadow",
    startFrame: cursor,
    durationFrames: foreshadowFrames,
    text: script.foreshadow,
    ...fsHint,
    intraBeats: foreshadowIntraBeats(foreshadowFrames),
  });
  cursor += foreshadowFrames - TRANSITION_FRAMES;

  // Body sections
  script.body.forEach((text, i) => {
    const bodyHint = getBodyHint(text);
    const key = `BODY_${i}_IN`;
    beats[key] = cursor;
    sections.push({
      name: `body_${i}`,
      startFrame: cursor,
      durationFrames: bodyFrames[i] ?? 0,
      text,
      ...bodyHint,
      intraBeats: bodyIntraBeats(
        bodyFrames[i] ?? 0,
        i,
        bodyHint.componentHint === 'countup',
      ),
    });
    cursor += (bodyFrames[i] ?? 0) - TRANSITION_FRAMES;
  });

  // Payoff/closing section (extended)
  beats["PAYOFF_IN"] = cursor;
  sections.push({
    name: "payoff",
    startFrame: cursor,
    durationFrames: payoffFrames + CLOSING_BUFFER,
    text: script.payoff,
    componentHint: 'blur-reveal',
    intraBeats: payoffIntraBeats(),
  });

  const colorPalette = style === "ranking" ? RANKING_PALETTE : KINETIC_PALETTE;

  // Closing spec: payoff text + channel signature
  const closing: ClosingSpec = {
    lines: [script.payoff, 'E.D.D.I.E.'],
    accentLineIndex: 1,
    holdFrames: 60,
  };

  return {
    beats,
    totalFrames,
    fps,
    sections,
    colorPalette,
    closing,
  };
}

// SYNC: ~/eddie/src/video/spec-generator.ts
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

export type DataBadgeData = {
  value: string;
  label: string;
  sectionIndex: number;
};

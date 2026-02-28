export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const seconds = (n: number) => Math.round(n * FPS);

export const FADES = {
  quick: 6,
  normal: 12,
  slow: 20,
} as const;

export const SAFE_ZONES = {
  top: 192,
  bottom: 288,
  sideMargin: 64,
} as const;

export const CLOSING = {
  breathingFrames: 20,
  holdFrames: 60,
} as const;

export const STAGGER = {
  fast: 1,
  normal: 3,
  slow: 5,
} as const;

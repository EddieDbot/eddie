import type { SpringConfig } from "remotion";

export const SPRING_PRESETS: Record<string, Partial<SpringConfig>> = {
  smooth: { damping: 200 },
  snappy: { damping: 20, stiffness: 200 },
  bouncy: { damping: 8 },
  heavy: { damping: 15, stiffness: 80, mass: 2 },
  gentle: { damping: 200, stiffness: 180, mass: 0.6 },
} as const;

export type SpringPreset = keyof typeof SPRING_PRESETS;

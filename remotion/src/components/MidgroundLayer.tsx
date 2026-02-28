import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import type { AnimationSection } from "../types/animation-spec";

interface Props {
  sections: AnimationSection[];
  colorPalette: { primary: string; accent: string; background: string };
}

const LINE_CONFIGS = [
  { width: 200, baseY: 576,  baseX: 40, noiseKey: "line-0", noiseOffset: 0 },
  { width: 300, baseY: 1056, baseX: 40, noiseKey: "line-1", noiseOffset: 0.5 },
  { width: 280, baseY: 1440, baseX: 40, noiseKey: "line-2", noiseOffset: 1.0 },
] as const;

const ORB_CONFIGS = [
  { baseX: 160,  baseY: 380,  r: 6, colorKey: "primary" as const, opacity: 0.20 },
  { baseX: 820,  baseY: 720,  r: 8, colorKey: "accent"  as const, opacity: 0.18 },
  { baseX: 300,  baseY: 1100, r: 5, colorKey: "primary" as const, opacity: 0.15 },
  { baseX: 940,  baseY: 1400, r: 7, colorKey: "accent"  as const, opacity: 0.25 },
  { baseX: 540,  baseY: 1700, r: 6, colorKey: "primary" as const, opacity: 0.17 },
] as const;

export const MidgroundLayer: React.FC<Props> = ({ sections: _sections, colorPalette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const t = frame / (fps || 30);
  const scanY = interpolate(frame % 60, [0, 60], [0, 1920]);

  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {/* Horizontal accent lines */}
      {LINE_CONFIGS.map((line, i) => {
        const xDrift = noise2D(line.noiseKey, t * 0.1, line.noiseOffset) * 60;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: line.baseY,
              left: line.baseX + xDrift,
              width: line.width,
              height: 1,
              backgroundColor: colorPalette.accent,
              opacity: 0.3,
              pointerEvents: "none",
            }}
          />
        );
      })}

      {/* Scan line */}
      <div
        style={{
          position: "absolute",
          top: scanY,
          left: 0,
          width: "100%",
          height: 1,
          backgroundColor: colorPalette.primary,
          opacity: 0.08,
          pointerEvents: "none",
        }}
      />

      {/* Data orbs */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {ORB_CONFIGS.map((orb, i) => {
          const cx = orb.baseX + noise2D(`orb-cx-${i}`, t * 0.08, i) * 40;
          const cy = orb.baseY + noise2D(`orb-cy-${i}`, i, t * 0.08) * 50;
          const color =
            orb.colorKey === "primary" ? colorPalette.primary : colorPalette.accent;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={orb.r}
              fill={color}
              opacity={orb.opacity}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};

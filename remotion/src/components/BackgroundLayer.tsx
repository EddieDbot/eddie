import React from "react";
import {
  AbsoluteFill,
  interpolate,
  interpolateColors,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { noise2D } from "@remotion/noise";
import type { AnimationSection } from "../types/animation-spec";

interface Props {
  sections: AnimationSection[];
  colorPalette: { primary: string; accent: string; background: string };
}

export const BackgroundLayer: React.FC<Props> = ({
  sections,
  colorPalette,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drift = interpolate(frame, [0, 1800], [0, 40], {
    extrapolateRight: "clamp",
  });

  const activeSectionIdx = sections.findIndex(
    (s) => frame >= s.startFrame && frame < s.startFrame + s.durationFrames,
  );
  const activeSection =
    activeSectionIdx >= 0 ? sections[activeSectionIdx] : null;

  const colorProgress =
    sections.length > 0
      ? activeSectionIdx / Math.max(1, sections.length - 1)
      : 0;

  const shiftedPrimary = interpolateColors(
    colorProgress,
    [0, 1],
    [colorPalette.primary, colorPalette.accent],
  );

  const sectionStart = activeSection?.startFrame ?? 0;
  const durationFrames = Math.max(61, activeSection?.durationFrames ?? 61);
  const relativeFrame = frame - sectionStart;

  const orb1Opacity = interpolate(
    relativeFrame,
    [0, 15, 60, durationFrames],
    [0.08, 0.2, 0.15, 0.12],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const orb2Opacity = interpolate(
    relativeFrame,
    [0, 15, 60, durationFrames],
    [0.08 * 0.3, 0.2 * 0.3, 0.15 * 0.3, 0.12 * 0.3],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const orb3Opacity = interpolate(
    relativeFrame,
    [0, 15, 60, durationFrames],
    [0.08 * 0.2, 0.2 * 0.2, 0.15 * 0.2, 0.12 * 0.2],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const t = frame / (fps || 30);

  const orb1DriftX = noise2D("orb-1-x", t * 0.2, 0) * 30;
  const orb1DriftY = noise2D("orb-1-y", 0, t * 0.2) * 20;

  const orb2DriftX = noise2D("orb-2-x", t * 0.18, 0.5) * 30;
  const orb2DriftY = noise2D("orb-2-y", 0.5, t * 0.18) * 20;

  const orb3DriftX = noise2D("orb-3-x", t * 0.15, 1.0) * 30;
  const orb3DriftY = noise2D("orb-3-y", 1.0, t * 0.15) * 20;

  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      {/* Base gradient */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, #0a0a2e 0%, #050510 60%, #020208 100%)",
        }}
      />

      {/* Drifting SVG grid */}
      <AbsoluteFill style={{ opacity: 0.12 }}>
        <svg
          width="1080"
          height="1920"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <defs>
            <pattern
              id="bg-grid"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${drift % 80}, ${drift % 80})`}
            >
              <path
                d="M 80 0 L 0 0 0 80"
                fill="none"
                stroke={shiftedPrimary}
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="1080" height="1920" fill="url(#bg-grid)" />
        </svg>
      </AbsoluteFill>

      {/* Orb 1 — top center, primary */}
      <div
        style={{
          position: "absolute",
          top: -100 + orb1DriftY,
          left: "50%",
          transform: `translateX(calc(-50% + ${orb1DriftX}px))`,
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${colorPalette.primary} 0%, transparent 70%)`,
          opacity: orb1Opacity,
          filter: "blur(60px)",
        }}
      />

      {/* Orb 2 — bottom left, accent */}
      <div
        style={{
          position: "absolute",
          bottom: 200 + orb2DriftY,
          left: -80 + orb2DriftX,
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${colorPalette.accent} 0%, transparent 70%)`,
          opacity: orb2Opacity,
          filter: "blur(80px)",
        }}
      />

      {/* Orb 3 — middle right, primary/accent mix */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          right: -120 + orb3DriftX,
          transform: `translateY(calc(-50% + ${orb3DriftY}px))`,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${shiftedPrimary} 0%, transparent 70%)`,
          opacity: orb3Opacity,
          filter: "blur(70px)",
        }}
      />
    </AbsoluteFill>
  );
};

import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  value: string;
  label: string;
}

export const DataBadge: React.FC<Props> = ({ value, label }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entryProgress = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 160 },
  });

  const translateX = interpolate(entryProgress, [0, 1], [120, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = interpolate(entryProgress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const idleScale = interpolate(
    Math.sin((frame / (fps || 30)) * 0.4 * Math.PI * 2),
    [-1, 1],
    [0.98, 1.02],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 120,
        right: 40,
        transform: `translateX(${translateX}px) scale(${idleScale})`,
        opacity,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(5,5,16,0.85)",
          border: "1px solid rgba(0,212,255,0.3)",
          borderRadius: 16,
          padding: "24px 32px",
          backdropFilter: "blur(12px)",
          minWidth: 200,
          textAlign: "right",
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 900,
            color: "#00D4FF",
            fontFamily: "Inter, system-ui, sans-serif",
            lineHeight: 1,
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 400,
            color: "rgba(255,255,255,0.5)",
            fontFamily: "Inter, system-ui, sans-serif",
            marginTop: 8,
            maxWidth: "none",
          }}
        >
          {label.slice(0, 30)}
        </div>
      </div>
    </div>
  );
};

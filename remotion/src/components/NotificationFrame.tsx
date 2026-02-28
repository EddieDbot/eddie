import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  emotion?: string;
  showBadge?: boolean;
  accentColor?: string;
  children: React.ReactNode;
}

export const NotificationFrame: React.FC<Props> = ({
  emotion,
  showBadge = false,
  accentColor = "#00D4FF",
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const borderProgress = spring({
    frame,
    fps,
    config: { damping: 180, stiffness: 140 },
  });

  const borderOpacity = interpolate(borderProgress, [0, 1], [0, 0.4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const glowProgress = spring({
    frame: Math.max(0, frame - 4),
    fps,
    config: { damping: 80, stiffness: 300 },
  });

  const glowDecay = spring({
    frame: Math.max(0, frame - 14),
    fps,
    config: { damping: 60, stiffness: 200 },
  });

  const glowOpacity = Math.max(0, glowProgress - glowDecay);

  const borderAlpha = Math.round(borderOpacity * 255)
    .toString(16)
    .padStart(2, "0");

  const glowAlpha = Math.round(glowOpacity * 0.4 * 255)
    .toString(16)
    .padStart(2, "0");

  return (
    <AbsoluteFill>
      {children}
      {/* Border overlay — full-frame border, doesn't affect children layout */}
      <AbsoluteFill
        style={{
          border: `1px solid ${accentColor}${borderAlpha}`,
          boxShadow: `inset 0 0 ${glowOpacity * 24}px ${accentColor}${glowAlpha}`,
          pointerEvents: "none",
        }}
      />
      {showBadge && emotion && (
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 64,
            backgroundColor: `${accentColor}CC`,
            color: "#050510",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "4px 14px",
            borderRadius: 20,
            textTransform: "uppercase",
          }}
        >
          {emotion}
        </div>
      )}
    </AbsoluteFill>
  );
};

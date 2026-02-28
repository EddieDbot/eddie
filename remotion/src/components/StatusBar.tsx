import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { TerminalDot } from "./TerminalDot";

interface Props {
  source: string;
  color?: string;
}

export const StatusBar: React.FC<Props> = ({
  source,
  color = "#00D4FF",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const entryProgress = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 180 },
  });

  const opacity = interpolate(entryProgress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const progressPct = interpolate(frame, [0, durationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 44,
        zIndex: 100,
        background: "rgba(5,5,16,0.8)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        paddingLeft: 24,
        paddingRight: 24,
        opacity,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <TerminalDot color="#00FF88" size={10} pulseHz={0.5} />
        <span
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 16,
            fontWeight: 700,
            color: "#00FF88",
            letterSpacing: "0.12em",
            marginLeft: 10,
          }}
        >
          LIVE
        </span>
      </div>

      <div
        style={{
          flex: 1,
          textAlign: "center",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 16,
          fontWeight: 400,
          color: "white",
          opacity: 0.55,
          letterSpacing: "0.08em",
        }}
      >
        {source}
      </div>

      <div
        style={{
          width: 80,
          height: 3,
          borderRadius: 2,
          backgroundColor: "rgba(255,255,255,0.15)",
        }}
      >
        <div
          style={{
            width: `${progressPct}%`,
            height: "100%",
            borderRadius: 2,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
};

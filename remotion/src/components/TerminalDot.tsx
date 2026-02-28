import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";

interface Props {
  color?: string;
  size?: number;
  pulseHz?: number;
}

export const TerminalDot: React.FC<Props> = ({
  color = "#00FF88",
  size = 8,
  pulseHz = 0.5,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(
    Math.sin((frame / fps) * pulseHz * Math.PI * 2),
    [-1, 1],
    [0.4, 1.0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color,
        opacity,
        boxShadow: `0 0 ${size * 1.5}px ${color}`,
      }}
    />
  );
};

import { interpolate } from "remotion";

interface Props {
  frame: number;
  totalFrames: number;
  color?: string;
}

export const ProgressBar: React.FC<Props> = ({
  frame,
  totalFrames,
  color = "#00D4FF",
}) => {
  const progress = interpolate(frame, [0, totalFrames], [0, 100], {
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
        height: 4,
        backgroundColor: "rgba(255, 255, 255, 0.1)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}, 0 0 16px ${color}40`,
          transition: "none",
        }}
      />
    </div>
  );
};

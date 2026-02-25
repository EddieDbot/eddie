import { spring, interpolate } from "remotion";

interface Props {
  text: string;
  frame: number;
  fps: number;
  delay?: number;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
}

export const AnimatedText: React.FC<Props> = ({
  text,
  frame,
  fps,
  delay = 0,
  color = "#FFFFFF",
  fontSize = 48,
  fontWeight = 700,
}) => {
  const words = text.split(" ");

  return (
    <span
      style={{
        display: "inline",
        fontSize,
        fontWeight,
        color,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        lineHeight: 1.3,
      }}
    >
      {words.map((word, i) => {
        const wordDelay = delay + i * 2;
        const adjustedFrame = Math.max(0, frame - wordDelay);

        const progress = spring({
          frame: adjustedFrame,
          fps,
          config: { damping: 200, stiffness: 180, mass: 0.6 },
        });

        const translateY = interpolate(progress, [0, 1], [28, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        const opacity = interpolate(progress, [0, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${translateY}px)`,
              opacity,
              marginRight: "0.28em",
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
};

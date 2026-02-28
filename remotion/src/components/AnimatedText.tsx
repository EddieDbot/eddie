import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { TYPOGRAPHY, MIN_FONT_SIZES, SPRING_PRESETS } from "../constants";

type Variant = 'hero' | 'title' | 'body' | 'code' | 'label';
type Entrance = 'slideUp' | 'slideDown' | 'scale' | 'fade' | 'none';
type SpringPresetKey = 'smooth' | 'bouncy' | 'snappy' | 'heavy' | 'gentle';

interface Props {
  text: string;
  delay?: number;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  enableIdle?: boolean;
  variant?: Variant;
  entrance?: Entrance;
  springPreset?: SpringPresetKey;
  staggerFrames?: number;
}

export const AnimatedText: React.FC<Props> = ({
  text,
  delay = 0,
  color = "#FFFFFF",
  fontSize,
  fontWeight,
  fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  enableIdle = true,
  variant,
  entrance = 'slideUp',
  springPreset = 'gentle',
  staggerFrames = 2,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  const typo = variant ? TYPOGRAPHY[variant] : undefined;

  const resolvedFontSize = variant
    ? Math.max(fontSize ?? typo!.fontSize, MIN_FONT_SIZES[variant])
    : (fontSize ?? 48);

  const resolvedFontWeight = fontWeight ?? (typo?.fontWeight ?? 700);
  const resolvedFontFamily = variant && 'fontFamily' in typo! && typo!.fontFamily
    ? (typo as { fontFamily: string }).fontFamily
    : fontFamily;

  const springConfig = SPRING_PRESETS[springPreset];

  return (
    <span
      style={{
        display: "inline",
        fontSize: resolvedFontSize,
        fontWeight: resolvedFontWeight,
        color,
        fontFamily: resolvedFontFamily,
        lineHeight: 1.3,
      }}
    >
      {words.map((word, i) => {
        const wordDelay = delay + i * staggerFrames;
        const adjustedFrame = Math.max(0, frame - wordDelay);

        if (entrance === 'none') {
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.28em",
              }}
            >
              {word}
            </span>
          );
        }

        const progress = spring({
          frame: adjustedFrame,
          fps,
          config: springConfig,
        });

        const opacity = interpolate(progress, [0, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        let transform: string;

        switch (entrance) {
          case 'slideDown': {
            const translateY = interpolate(progress, [0, 1], [-28, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const idleOffset = enableIdle && progress >= 0.99
              ? interpolate(
                  Math.sin((frame / fps + i * 0.15) * Math.PI * 0.6),
                  [-1, 1],
                  [-2.5, 2.5],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              : 0;
            transform = `translateY(${translateY + idleOffset}px)`;
            break;
          }
          case 'scale': {
            const s = interpolate(progress, [0, 1], [0.3, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            transform = `scale(${s})`;
            break;
          }
          case 'fade': {
            const idleOffset = enableIdle && progress >= 0.99
              ? interpolate(
                  Math.sin((frame / fps + i * 0.15) * Math.PI * 0.6),
                  [-1, 1],
                  [-2.5, 2.5],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              : 0;
            transform = `translateY(${idleOffset}px)`;
            break;
          }
          case 'slideUp':
          default: {
            const translateY = interpolate(progress, [0, 1], [28, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const idleOffset = enableIdle && progress >= 0.99
              ? interpolate(
                  Math.sin((frame / fps + i * 0.15) * Math.PI * 0.6),
                  [-1, 1],
                  [-2.5, 2.5],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                )
              : 0;
            transform = `translateY(${translateY + idleOffset}px)`;
            break;
          }
        }

        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform,
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

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { noise2D } from '@remotion/noise';

interface GlitchTextProps {
  text: string;
  startFrame?: number;
  intensity?: number;
  speed?: number;
  enableShadows?: boolean;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
}

export const GlitchText: React.FC<GlitchTextProps> = ({
  text,
  startFrame = 0,
  intensity = 0.6,
  speed = 1,
  enableShadows = true,
  color = '#FFFFFF',
  fontSize = 48,
  fontWeight = 700,
  fontFamily = 'Inter, sans-serif',
}) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    Math.max(0, frame - startFrame),
    [0, 8],
    [0, 1],
    { extrapolateRight: 'clamp' },
  );

  const redOffsetX =
    noise2D('glitch-r', frame * speed * 0.3, 0) * intensity * 6;
  const redOffsetY =
    noise2D('glitch-r', 0, frame * speed * 0.3) * intensity * 3;
  const cyanOffsetX =
    -noise2D('glitch-c', frame * speed * 0.3, 0) * intensity * 6;
  const cyanOffsetY =
    -noise2D('glitch-c', 0, frame * speed * 0.3) * intensity * 3;

  const cyclePos = frame % 3;
  const clipPath =
    cyclePos === 0
      ? 'inset(10% 0 80% 0)'
      : cyclePos === 1
        ? 'inset(40% 0 40% 0)'
        : 'none';

  const baseStyle: React.CSSProperties = {
    fontSize,
    fontWeight,
    fontFamily,
    whiteSpace: 'pre-wrap',
  };

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        opacity,
      }}
    >
      {/* Main layer */}
      <span
        style={{
          ...baseStyle,
          color,
          textShadow: enableShadows ? `0 0 8px ${color}80` : undefined,
        }}
      >
        {text}
      </span>

      {/* Red layer */}
      <span
        style={{
          ...baseStyle,
          position: 'absolute',
          left: 0,
          top: 0,
          color: '#FF0040',
          mixBlendMode: 'screen',
          transform: `translate(${redOffsetX}px, ${redOffsetY}px)`,
          clipPath,
        }}
      >
        {text}
      </span>

      {/* Cyan layer */}
      <span
        style={{
          ...baseStyle,
          position: 'absolute',
          left: 0,
          top: 0,
          color: '#00FFFF',
          mixBlendMode: 'screen',
          transform: `translate(${cyanOffsetX}px, ${cyanOffsetY}px)`,
          clipPath,
        }}
      >
        {text}
      </span>
    </span>
  );
};

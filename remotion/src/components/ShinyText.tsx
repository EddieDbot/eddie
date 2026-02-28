import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';

interface ShinyTextProps {
  text: string;
  startFrame?: number;
  color?: string;
  shineColor?: string;
  duration?: number;
  pauseDuration?: number;
  direction?: 'right' | 'left';
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
}

export const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  startFrame = 0,
  color = '#FFFFFF',
  shineColor = 'rgba(255,255,255,0.85)',
  duration = 45,
  pauseDuration = 60,
  direction = 'right',
  fontSize = 48,
  fontWeight = 700,
  fontFamily = 'Inter, sans-serif',
}) => {
  const frame = useCurrentFrame();

  const localFrame = Math.max(0, frame - startFrame);
  const cycleFrame = localFrame % (duration + pauseDuration);
  const sweepProgress = Math.min(cycleFrame / duration, 1);

  const bgPos =
    direction === 'right'
      ? interpolate(sweepProgress, [0, 1], [200, -100])
      : interpolate(sweepProgress, [0, 1], [-200, 100]);

  const opacity = interpolate(localFrame, [0, 8], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <span style={{ opacity }}>
      <span
        style={{
          background: `linear-gradient(90deg, ${color} 25%, ${shineColor} 50%, ${color} 75%)`,
          backgroundSize: '200% 100%',
          backgroundPositionX: `${bgPos}%`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontSize,
          fontWeight,
          fontFamily,
        }}
      >
        {text}
      </span>
    </span>
  );
};

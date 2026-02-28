import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { SPRING_PRESETS } from '../constants';

interface BlurTextProps {
  text: string;
  startFrame?: number;
  animateBy?: 'words' | 'letters';
  direction?: 'top' | 'bottom' | 'left' | 'right';
  staggerDelay?: number;
  blurAmount?: number;
  distance?: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  fontFamily?: string;
  maxWidth?: number;
}

export const BlurText: React.FC<BlurTextProps> = ({
  text,
  startFrame = 0,
  animateBy = 'words',
  direction = 'bottom',
  staggerDelay = 4,
  blurAmount = 8,
  distance = 20,
  fontSize = 48,
  fontWeight = 700,
  color = '#FFFFFF',
  fontFamily = 'Inter, sans-serif',
  maxWidth,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const tokens =
    animateBy === 'words' ? text.split(' ') : text.split('');

  const getTransform = (progress: number): string => {
    const offset = interpolate(progress, [0, 1], [distance, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const negOffset = interpolate(progress, [0, 1], [-distance, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });

    switch (direction) {
      case 'top':
        return `translateY(${negOffset}px)`;
      case 'bottom':
        return `translateY(${offset}px)`;
      case 'left':
        return `translateX(${negOffset}px)`;
      case 'right':
        return `translateX(${offset}px)`;
    }
  };

  return (
    <span
      style={{
        display: 'inline',
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
        fontSize,
        fontWeight,
        color,
        fontFamily,
      }}
    >
      {tokens.map((token, i) => {
        const localFrame = Math.max(
          0,
          frame - startFrame - i * staggerDelay,
        );
        const progress = spring({
          frame: localFrame,
          fps,
          config: SPRING_PRESETS.smooth,
        });

        const blur = interpolate(progress, [0, 1], [blurAmount, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
        const opacity = interpolate(progress, [0, 1], [0, 1]);

        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              filter: `blur(${blur}px)`,
              transform: getTransform(progress),
              opacity,
              marginRight: animateBy === 'words' ? '0.25em' : '0.02em',
            }}
          >
            {token}
          </span>
        );
      })}
    </span>
  );
};

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { COLORS } from '../constants';

interface Props {
  children: React.ReactNode;
  background?: 'dark' | 'surface' | 'warm' | 'cosmic' | 'light' | string;
  safeMargin?: 'minimum' | 'recommended' | 'none';
  fadeIn?: number;
  fadeOut?: number;
}

const BACKGROUND_MAP: Record<string, string> = {
  dark: COLORS.dark,
  surface: COLORS.surface,
  warm: COLORS.warm,
  cosmic: COLORS.cosmic,
  light: COLORS.light,
};

const MARGIN_MAP = {
  none: { paddingTop: 0, paddingLeft: 0 },
  minimum: { paddingTop: 54, paddingLeft: 96 },
  recommended: { paddingTop: 86, paddingLeft: 154 },
} as const;

export const SceneContainer: React.FC<Props> = ({
  children,
  background = 'dark',
  safeMargin = 'recommended',
  fadeIn,
  fadeOut,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const backgroundColor = BACKGROUND_MAP[background] ?? background;
  const { paddingTop, paddingLeft } = MARGIN_MAP[safeMargin];

  let opacity = 1;
  if (fadeIn !== undefined) {
    const fadeInOpacity = interpolate(frame, [0, fadeIn], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    opacity = Math.min(opacity, fadeInOpacity);
  }
  if (fadeOut !== undefined) {
    const fadeOutOpacity = interpolate(
      frame,
      [durationInFrames - fadeOut, durationInFrames],
      [1, 0],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    opacity = Math.min(opacity, fadeOutOpacity);
  }

  return (
    <AbsoluteFill style={{ backgroundColor, opacity }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          padding: `${paddingTop}px ${paddingLeft}px`,
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

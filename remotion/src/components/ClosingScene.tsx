import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, SAFE_ZONES } from '../constants';
import { BlurText } from './BlurText';

interface Props {
  lines: string[];
  accentLineIndex?: number;
  accentColor?: string;
}

const EDDIE_PATTERN = /^E\.D\.D\.I\.E\.?$/;

export const ClosingScene: React.FC<Props> = ({
  lines,
  accentLineIndex,
  accentColor = COLORS.insightOrange,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const breathingFrames =
    durationInFrames <= 450 ? 10 : durationInFrames <= 750 ? 15 : 20;

  const resolvedAccentIdx = accentLineIndex ?? lines.length - 1;

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.dark }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: SAFE_ZONES.top,
          paddingBottom: SAFE_ZONES.bottom,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
            position: 'relative',
          }}
        >
          {lines.map((line, i) => {
            const lineStart = breathingFrames + i * 60;
            const isAccent =
              i === resolvedAccentIdx || EDDIE_PATTERN.test(line);
            const lineColor = isAccent
              ? accentColor
              : 'rgba(255,255,255,0.9)';
            const lineFontSize = isAccent ? 48 : 44;
            const lineFontWeight = isAccent ? 700 : 600;

            return (
              <div key={i} style={{ position: 'relative' }}>
                {isAccent && frame >= lineStart && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: 500,
                      height: 500,
                      background: `radial-gradient(circle, ${accentColor}1A 0%, transparent 70%)`,
                      pointerEvents: 'none',
                    }}
                  />
                )}
                <BlurText
                  text={line}
                  startFrame={lineStart}
                  animateBy="words"
                  direction="bottom"
                  staggerDelay={4}
                  blurAmount={8}
                  fontSize={lineFontSize}
                  fontWeight={lineFontWeight}
                  color={lineColor}
                />
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

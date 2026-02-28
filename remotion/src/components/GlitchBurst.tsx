import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { noise2D } from '@remotion/noise';

interface GlitchBurstProps {
  children: React.ReactNode;
  burstInterval?: number;
  burstDuration?: number;
  intensity?: number;
}

export const GlitchBurst: React.FC<GlitchBurstProps> = ({
  children,
  burstInterval = 60,
  burstDuration = 6,
  intensity = 0.7,
}) => {
  const frame = useCurrentFrame();

  const cycleFrame = frame % burstInterval;
  const inBurst = cycleFrame < burstDuration;

  const translateX = inBurst
    ? noise2D('burst-x', frame * 0.5, 0) * intensity * 8
    : 0;
  const translateY = inBurst
    ? noise2D('burst-y', 0, frame * 0.5) * intensity * 4
    : 0;
  const opacity = inBurst
    ? interpolate(
        cycleFrame,
        [0, 1, burstDuration - 1, burstDuration],
        [0.7, 1, 1, 1],
        { extrapolateRight: 'clamp' },
      )
    : 1;

  return (
    <div
      style={{
        transform: inBurst
          ? `translate(${translateX}px, ${translateY}px)`
          : undefined,
        opacity,
      }}
    >
      {children}
    </div>
  );
};

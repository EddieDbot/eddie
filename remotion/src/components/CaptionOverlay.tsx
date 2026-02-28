import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import {
  createTikTokStyleCaptions,
  type Caption,
  type TikTokPage,
  type TikTokToken,
} from "@remotion/captions";
import { COLORS, SAFE_ZONES } from "../constants";

const { fontFamily } = loadFont();

interface Props {
  captions: Caption[];
  accentColor?: string;
}

export const CaptionOverlay: React.FC<Props> = ({
  captions,
  accentColor = COLORS.insightOrange,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;

  const { pages } = useMemo(
    () => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 800 }),
    [captions],
  );

  const activePage: TikTokPage | undefined = pages.find((p) => {
    const pageEnd = p.startMs + p.durationMs;
    return currentMs >= p.startMs && currentMs < pageEnd;
  });

  if (!activePage) return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: SAFE_ZONES.bottom + 20,
        paddingLeft: 48,
        paddingRight: 48,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.75)",
          borderRadius: 14,
          padding: "14px 24px",
          maxWidth: "88%",
          textAlign: "center",
        }}
      >
        {activePage.tokens.map((token: TikTokToken, i: number) => {
          const isActive = currentMs >= token.fromMs && currentMs < token.toMs;

          return (
            <span
              key={i}
              style={{
                fontSize: 44,
                fontWeight: 700,
                fontFamily,
                lineHeight: 1.3,
                color: isActive ? accentColor : "#FFFFFF",
                display: "inline-block",
                transform: isActive ? "scale(1.15)" : undefined,
                textShadow: isActive
                  ? `0 0 20px ${accentColor}80`
                  : "0 2px 8px rgba(0,0,0,0.8)",
                whiteSpace: "pre",
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

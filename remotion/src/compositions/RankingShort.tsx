import React from "react";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import type { CalculateMetadataFunction } from "remotion";
import { z } from "zod";
import { loadFont } from "@remotion/google-fonts/Inter";

const { fontFamily } = loadFont();

export const RankingShortSchema = z.object({
  title: z.string(),
  items: z.array(
    z.object({
      rank: z.number(),
      label: z.string(),
      detail: z.string().optional(),
    }),
  ),
  emotionTarget: z.enum(["LOL", "WTF", "OMG", "Wow", "Finally"]).optional(),
  source: z.string().optional(),
});

type Props = z.infer<typeof RankingShortSchema>;

const CYAN = "#00D4FF";
const PURPLE = "#7B61FF";
const MAGENTA = "#FF2D78";
const YELLOW = "#FFD600";
const WHITE = "#FFFFFF";
const BG = "#070714";

const EMOTION_COLORS: Record<string, [string, string]> = {
  WTF: [MAGENTA, PURPLE],
  OMG: [YELLOW, MAGENTA],
  LOL: [CYAN, YELLOW],
  Wow: [CYAN, PURPLE],
  Finally: [PURPLE, CYAN],
};

function emotionPalette(e?: string): [string, string] {
  return EMOTION_COLORS[e ?? "Wow"] ?? [CYAN, PURPLE];
}

const TITLE_SEC = 2.0;
const ITEM_SEC = 1.5;
const OUTRO_SEC = 1.5;

export const calculateRankingMetadata: CalculateMetadataFunction<Props> = ({
  props,
}) => {
  const totalSec = TITLE_SEC + props.items.length * ITEM_SEC + OUTRO_SEC;
  return { durationInFrames: Math.ceil(totalSec * 30) };
};

const TitleCard: React.FC<{
  title: string;
  accent: string;
  secondary: string;
  frame: number;
  fps: number;
}> = ({ title, accent, secondary, frame, fps }) => {
  const reveal = spring({
    frame,
    fps,
    config: { damping: 180, stiffness: 200 },
  });
  const scale = interpolate(reveal, [0, 1], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(reveal, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${scale})`,
        opacity,
        paddingLeft: 64,
        paddingRight: 64,
        boxSizing: "border-box" as const,
        flexDirection: "column",
        gap: 24,
      }}
    >
      <div
        style={{
          background: `linear-gradient(135deg, ${accent}22, ${secondary}22)`,
          border: `2px solid ${accent}40`,
          borderRadius: 20,
          padding: "48px 48px",
          width: "100%",
          textAlign: "center" as const,
        }}
      >
        <div
          style={{
            color: accent,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.2em",
            fontFamily,
            textTransform: "uppercase" as const,
            marginBottom: 24,
          }}
        >
          RANKING
        </div>
        <div
          style={{
            color: WHITE,
            fontSize: 72,
            fontWeight: 900,
            fontFamily,
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const RankItem: React.FC<{
  rank: number;
  label: string;
  detail?: string;
  accent: string;
  secondary: string;
  frame: number;
  fps: number;
  isTop: boolean;
}> = ({ rank, label, detail, accent, secondary, frame, fps, isTop }) => {
  const reveal = spring({
    frame,
    fps,
    config: { damping: 160, stiffness: 250 },
  });
  const translateX = interpolate(reveal, [0, 1], [-120, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(reveal, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rankColor = isTop ? accent : secondary;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        paddingLeft: 64,
        paddingRight: 64,
        boxSizing: "border-box" as const,
      }}
    >
      <div
        style={{
          transform: `translateX(${translateX}px)`,
          opacity,
          display: "flex",
          alignItems: "center",
          gap: 32,
          background: `linear-gradient(90deg, ${rankColor}18, transparent)`,
          borderLeft: `4px solid ${rankColor}`,
          borderRadius: "0 16px 16px 0",
          padding: "32px 40px",
        }}
      >
        <div
          style={{
            color: rankColor,
            fontSize: 96,
            fontWeight: 900,
            fontFamily,
            lineHeight: 1,
            minWidth: 100,
            textAlign: "center" as const,
            textShadow: `0 0 40px ${rankColor}60`,
          }}
        >
          {rank}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              color: WHITE,
              fontSize: 60,
              fontWeight: 800,
              fontFamily,
              lineHeight: 1.2,
            }}
          >
            {label}
          </div>
          {detail && (
            <div
              style={{
                color: "rgba(255,255,255,0.6)",
                fontSize: 36,
                fontWeight: 400,
                fontFamily,
                marginTop: 8,
              }}
            >
              {detail}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const OutroCard: React.FC<{
  accent: string;
  frame: number;
  fps: number;
}> = ({ accent, frame, fps }) => {
  const reveal = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 150 },
  });
  const opacity = interpolate(reveal, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", opacity }}
    >
      <div
        style={{
          color: accent,
          fontSize: 48,
          fontWeight: 800,
          fontFamily,
          letterSpacing: "0.1em",
          textTransform: "uppercase" as const,
          textAlign: "center" as const,
        }}
      >
        @EddieDbot
      </div>
    </AbsoluteFill>
  );
};

export const RankingShort: React.FC<Props> = ({
  title,
  items,
  emotionTarget,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [accent, secondary] = emotionPalette(emotionTarget);

  const titleFrames = Math.ceil(TITLE_SEC * fps);
  const itemFrames = Math.ceil(ITEM_SEC * fps);
  const outroFrames = Math.ceil(OUTRO_SEC * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: BG, overflow: "hidden" }}>
      {/* Subtle gradient background */}
      <AbsoluteFill>
        <div
          style={{
            position: "absolute",
            top: "10%",
            left: "20%",
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${accent}10 0%, transparent 65%)`,
            filter: "blur(80px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "10%",
            right: "10%",
            width: 400,
            height: 400,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${secondary}10 0%, transparent 65%)`,
            filter: "blur(60px)",
          }}
        />
      </AbsoluteFill>

      {/* Title card */}
      <Sequence from={0} durationInFrames={titleFrames}>
        <TitleCard
          title={title}
          accent={accent}
          secondary={secondary}
          frame={frame}
          fps={fps}
        />
      </Sequence>

      {/* Items — stagger reveal */}
      {items.map((item, i) => (
        <Sequence
          key={i}
          from={titleFrames + i * itemFrames}
          durationInFrames={itemFrames}
        >
          <RankItem
            rank={item.rank}
            label={item.label}
            detail={item.detail}
            accent={accent}
            secondary={secondary}
            frame={frame - (titleFrames + i * itemFrames)}
            fps={fps}
            isTop={item.rank <= 1}
          />
        </Sequence>
      ))}

      {/* Outro */}
      <Sequence
        from={durationInFrames - outroFrames}
        durationInFrames={outroFrames}
      >
        <OutroCard
          accent={accent}
          frame={frame - (durationInFrames - outroFrames)}
          fps={fps}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

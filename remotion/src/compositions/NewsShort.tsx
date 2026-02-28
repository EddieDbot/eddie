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
import { TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { springTiming } from "@remotion/transitions";
import { evolvePath } from "@remotion/paths";
import { z } from "zod";
import { AnimatedText } from "../components/AnimatedText";
import { CaptionOverlay } from "../components/CaptionOverlay";
import { BackgroundLayer } from "../components/BackgroundLayer";
import { MidgroundLayer } from "../components/MidgroundLayer";
import { StatusBar } from "../components/StatusBar";
import { NotificationFrame } from "../components/NotificationFrame";
import { DataBadge } from "../components/DataBadge";
import { GlitchText } from "../components/GlitchText";
import { ShinyText } from "../components/ShinyText";
import { CountUpWithLabel } from "../components/CountUp";
import { ClosingScene } from "../components/ClosingScene";
import { loadFont } from "@remotion/google-fonts/Inter";
import { COLORS } from "../constants";
import type { AnimationSpec, AnimationSection, DataBadgeData } from "../types/animation-spec";

const { fontFamily } = loadFont();

const CaptionSchema = z.object({
  text: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  timestampMs: z.number(),
  confidence: z.number(),
});

export const NewsShortSchema = z.object({
  hook: z.string(),
  foreshadow: z.string(),
  body: z.array(z.string()),
  payoff: z.string(),
  title: z.string(),
  source: z.string(),
  emotionTarget: z.enum(["LOL", "WTF", "OMG", "Wow", "Finally"]).optional(),
  captions: z.array(CaptionSchema).optional(),
  spec: z.custom<AnimationSpec>().optional(),
  dataBadges: z.array(z.custom<DataBadgeData>()).optional(),
  closingLines: z.array(z.string()).optional(),
  closingAccentIndex: z.number().optional(),
});

type Props = z.infer<typeof NewsShortSchema>;

const WORDS_PER_SEC = 2.8;
const MIN_HOOK_SEC = 2;
const MIN_FORESHADOW_SEC = 1.5;
const MIN_BODY_SEC = 2;
const MIN_PAYOFF_SEC = 1.5;
const TRANSITION_FRAMES = 8;
const CLOSING_EXTRA_FRAMES = 100;

function estimateSec(text: string, min: number): number {
  return Math.max(min, text.split(/\s+/).length / WORDS_PER_SEC);
}

export const calculateMetadata: CalculateMetadataFunction<Props> = ({
  props,
}) => {
  const hookSec = estimateSec(props.hook, MIN_HOOK_SEC);
  const foreshadowSec = estimateSec(props.foreshadow, MIN_FORESHADOW_SEC);
  const bodySec = props.body.reduce(
    (acc, s) => acc + estimateSec(s, MIN_BODY_SEC),
    0,
  );
  const payoffSec = estimateSec(props.payoff, MIN_PAYOFF_SEC);
  const totalSec = hookSec + foreshadowSec + bodySec + payoffSec;
  const sectionCount = 2 + props.body.length + 1;
  const transitionFrames = (sectionCount - 1) * TRANSITION_FRAMES;
  return {
    durationInFrames: Math.max(
      30,
      Math.ceil(totalSec * 30) - transitionFrames + CLOSING_EXTRA_FRAMES,
    ),
  };
};

const GlowDivider: React.FC<{ frame: number; fps: number; delay?: number }> = ({
  frame,
  fps,
  delay = 0,
}) => {
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 120, stiffness: 200 },
  });

  const clampedProgress = interpolate(progress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const { strokeDasharray, strokeDashoffset } = evolvePath(
    clampedProgress,
    "M 0 2 L 952 2",
  );

  return (
    <svg
      width="952"
      height="4"
      viewBox="0 0 952 4"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient
          id="glow-divider-gradient"
          x1="0"
          y1="0"
          x2="952"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#00D4FF" />
          <stop offset="100%" stopColor="#7B61FF" />
        </linearGradient>
      </defs>
      <path
        d="M 0 2 L 952 2"
        stroke="url(#glow-divider-gradient)"
        strokeWidth={2}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
        fill="none"
        strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 6px #00D4FF80)" }}
      />
    </svg>
  );
};

function splitAtWord(
  text: string,
  emphasisWord?: string,
): { before: string; emphasis: string; after: string } {
  if (!emphasisWord) return { before: text, emphasis: "", after: "" };
  const words = text.split(" ");
  const idx = words.findIndex(
    (w) => w.replace(/[.,!?'"]+$/, "") === emphasisWord,
  );
  if (idx < 0) return { before: text, emphasis: "", after: "" };
  return {
    before: words.slice(0, idx).join(" "),
    emphasis: words[idx] ?? "",
    after: words.slice(idx + 1).join(" "),
  };
}

const HookSection: React.FC<{
  hook: string;
  emotionTarget?: string;
  emphasisWord?: string;
}> = ({ hook, emotionTarget, emphasisWord }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const bgProgress = spring({ frame, fps, config: { damping: 300 } });
  const scaleIn = interpolate(bgProgress, [0, 1], [1.08, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(frame, [0, 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const accentSlide = spring({
    frame: Math.max(0, frame - 6),
    fps,
    config: { damping: 180, stiffness: 120 },
  });
  const accentX = interpolate(accentSlide, [0, 1], [-60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const label = emotionTarget ?? "Breaking";
  const { before, emphasis, after } = splitAtWord(hook, emphasisWord);
  const hasEmphasis = Boolean(emphasis);

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${scaleIn})`,
        opacity,
      }}
    >
      <div
        style={{
          paddingLeft: 64,
          paddingRight: 64,
          paddingTop: 80,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 28,
            transform: `translateX(${accentX}px)`,
            opacity: accentSlide,
          }}
        >
          <div
            style={{
              backgroundColor: "#00D4FF",
              paddingLeft: 14,
              paddingRight: 14,
              paddingTop: 6,
              paddingBottom: 6,
              borderRadius: 4,
              marginRight: 16,
            }}
          >
            <span
              style={{
                color: "#050510",
                fontSize: 22,
                fontWeight: 800,
                fontFamily,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              {label}
            </span>
          </div>
          <div
            style={{
              height: 2,
              flex: 1,
              background: "linear-gradient(90deg, #00D4FF40, transparent)",
            }}
          />
        </div>
        <div style={{ overflow: "hidden", marginBottom: 40 }}>
          {hasEmphasis ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                gap: "0.28em",
                fontSize: 72,
                fontWeight: 800,
                fontFamily,
                lineHeight: 1.3,
              }}
            >
              {before && (
                <AnimatedText
                  text={before}
                  delay={4}
                  color="#FFFFFF"
                  fontSize={72}
                  fontWeight={800}
                  fontFamily={fontFamily}
                />
              )}
              <GlitchText
                text={emphasis}
                startFrame={4}
                fontSize={72}
                fontWeight={800}
                fontFamily={fontFamily}
                color="#FFFFFF"
                intensity={0.5}
              />
              {after && (
                <AnimatedText
                  text={after}
                  delay={4}
                  color="#FFFFFF"
                  fontSize={72}
                  fontWeight={800}
                  fontFamily={fontFamily}
                />
              )}
            </div>
          ) : (
            <AnimatedText
              text={hook}
              delay={4}
              color="#FFFFFF"
              fontSize={72}
              fontWeight={800}
              fontFamily={fontFamily}
            />
          )}
        </div>
        <GlowDivider frame={frame} fps={fps} delay={10} />
      </div>
    </AbsoluteFill>
  );
};

const ForeshadowSection: React.FC<{
  foreshadow: string;
  emphasisWord?: string;
}> = ({ foreshadow, emphasisWord }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideProgress = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 140 },
  });
  const translateY = interpolate(slideProgress, [0, 1], [50, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(slideProgress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const { before, emphasis, after } = splitAtWord(foreshadow, emphasisWord);
  const hasEmphasis = Boolean(emphasis);

  return (
    <AbsoluteFill
      style={{
        paddingLeft: 64,
        paddingRight: 64,
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      <div style={{ transform: `translateY(${translateY}px)`, opacity }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            backgroundColor: "rgba(0, 212, 255, 0.08)",
            border: "1px solid rgba(0, 212, 255, 0.3)",
            borderRadius: 8,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 8,
            paddingBottom: 8,
            marginBottom: 32,
          }}
        >
          <span
            style={{
              color: "#00D4FF",
              fontSize: 22,
              fontWeight: 600,
              fontFamily,
              letterSpacing: "0.04em",
            }}
          >
            WHAT HAPPENS NEXT
          </span>
        </div>
        {hasEmphasis ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: "0.28em",
              fontSize: 58,
              fontWeight: 600,
              fontFamily,
              lineHeight: 1.3,
            }}
          >
            {before && (
              <AnimatedText
                text={before}
                delay={4}
                color="rgba(255,255,255,0.9)"
                fontSize={58}
                fontWeight={600}
                fontFamily={fontFamily}
              />
            )}
            <ShinyText
              text={emphasis}
              startFrame={4}
              fontSize={58}
              fontWeight={600}
              fontFamily={fontFamily}
              color="rgba(255,255,255,0.9)"
            />
            {after && (
              <AnimatedText
                text={after}
                delay={4}
                color="rgba(255,255,255,0.9)"
                fontSize={58}
                fontWeight={600}
                fontFamily={fontFamily}
              />
            )}
          </div>
        ) : (
          <AnimatedText
            text={foreshadow}
            delay={4}
            color="rgba(255,255,255,0.9)"
            fontSize={58}
            fontWeight={600}
            fontFamily={fontFamily}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

const BodySection: React.FC<{
  text: string;
  index: number;
  total: number;
  componentHint?: string;
  extractedNumber?: number;
  numberPrefix?: string;
  numberSuffix?: string;
}> = ({
  text,
  index,
  total,
  componentHint,
  extractedNumber,
  numberPrefix,
  numberSuffix,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardProgress = spring({
    frame,
    fps,
    config: { damping: 200, stiffness: 140 },
  });
  const translateY = interpolate(cardProgress, [0, 1], [60, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(cardProgress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const dots = Array.from({ length: total }, (_, i) => i);
  const showCountUp =
    componentHint === "countup" &&
    extractedNumber !== undefined &&
    extractedNumber > 0;

  return (
    <AbsoluteFill
      style={{
        paddingLeft: 64,
        paddingRight: 64,
        paddingTop: 120,
        paddingBottom: 120,
        justifyContent: "center",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 48,
          transform: `translateY(${translateY * 0.5}px)`,
          opacity,
        }}
      >
        {dots.map((i) => (
          <div
            key={i}
            style={{
              width: i === index ? 32 : 8,
              height: 8,
              borderRadius: 4,
              backgroundColor:
                i === index ? "#7B61FF" : "rgba(255,255,255,0.2)",
              boxShadow: i === index ? "0 0 8px #7B61FF" : "none",
            }}
          />
        ))}
      </div>
      <div style={{ transform: `translateY(${translateY}px)`, opacity }}>
        {showCountUp && (
          <div style={{ marginBottom: 24 }}>
            <CountUpWithLabel
              to={extractedNumber!}
              prefix={numberPrefix}
              suffix={numberSuffix}
              label={text.slice(0, 40)}
              color={COLORS.eddieCyan}
              fontSize={80}
              fontWeight={800}
              fontFamily={fontFamily}
              labelColor="rgba(255,255,255,0.6)"
              labelFontSize={32}
            />
          </div>
        )}
        <AnimatedText
          text={text}
          delay={4}
          color="#FFFFFF"
          fontSize={54}
          fontWeight={700}
          fontFamily={fontFamily}
        />
      </div>
    </AbsoluteFill>
  );
};

const SourceBadge: React.FC<{
  source: string;
  title: string;
}> = ({ source, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entryProgress = spring({ frame, fps, config: { damping: 200 } });
  const translateX = interpolate(entryProgress, [0, 1], [80, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(entryProgress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 80,
        right: 40,
        transform: `translateX(${translateX}px)`,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(5, 5, 16, 0.85)",
          border: "1px solid rgba(0, 212, 255, 0.3)",
          borderRadius: 10,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 8,
          paddingBottom: 8,
          backdropFilter: "blur(10px)",
        }}
      >
        <span
          style={{
            color: "#00D4FF",
            fontSize: 22,
            fontWeight: 600,
            fontFamily,
          }}
        >
          {source}
        </span>
      </div>
      <span
        style={{
          color: "rgba(255,255,255,0.35)",
          fontSize: 18,
          fontWeight: 400,
          fontFamily,
          paddingRight: 4,
        }}
      >
        {title}
      </span>
    </div>
  );
};

function buildFallbackSections(
  hook: string,
  foreshadow: string,
  body: string[],
  payoff: string,
  fps: number,
): AnimationSection[] {
  const sections: AnimationSection[] = [];
  let cursor = 0;

  const hookFrames = Math.ceil(estimateSec(hook, MIN_HOOK_SEC) * fps);
  sections.push({ name: "hook", startFrame: cursor, durationFrames: hookFrames, text: hook });
  cursor += hookFrames - TRANSITION_FRAMES;

  const fsFrames = Math.ceil(estimateSec(foreshadow, MIN_FORESHADOW_SEC) * fps);
  sections.push({ name: "foreshadow", startFrame: cursor, durationFrames: fsFrames, text: foreshadow });
  cursor += fsFrames - TRANSITION_FRAMES;

  body.forEach((text, i) => {
    const bf = Math.ceil(estimateSec(text, MIN_BODY_SEC) * fps);
    sections.push({ name: `body_${i}`, startFrame: cursor, durationFrames: bf, text });
    cursor += bf - TRANSITION_FRAMES;
  });

  const payoffFrames = Math.ceil(estimateSec(payoff, MIN_PAYOFF_SEC) * fps) + CLOSING_EXTRA_FRAMES;
  sections.push({ name: "payoff", startFrame: cursor, durationFrames: payoffFrames, text: payoff });

  return sections;
}

export const NewsShort: React.FC<Props> = ({
  hook,
  foreshadow,
  body,
  payoff,
  title,
  source,
  emotionTarget,
  captions,
  spec,
  dataBadges,
  closingLines,
  closingAccentIndex,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const hookFrames = Math.ceil(estimateSec(hook, MIN_HOOK_SEC) * fps);
  const foreshadowFrames = Math.ceil(estimateSec(foreshadow, MIN_FORESHADOW_SEC) * fps);
  const bodyFrames = body.map((s) => Math.ceil(estimateSec(s, MIN_BODY_SEC) * fps));

  const palette = spec?.colorPalette ?? {
    primary: "#00D4FF",
    accent: "#7B61FF",
    background: "#050510",
  };

  const sections = spec?.sections ?? buildFallbackSections(hook, foreshadow, body, payoff, fps);

  // Resolve section hints from spec
  const hookSection = sections.find((s) => s.name === "hook");
  const foreshadowSection = sections.find((s) => s.name === "foreshadow");

  // Resolve closing lines
  const resolvedClosingLines = closingLines ?? spec?.closing?.lines ?? [payoff, "E.D.D.I.E."];
  const resolvedClosingAccentIndex =
    closingAccentIndex ?? spec?.closing?.accentLineIndex ?? resolvedClosingLines.length - 1;

  const closingFrames = Math.ceil(estimateSec(payoff, MIN_PAYOFF_SEC) * fps) + CLOSING_EXTRA_FRAMES;

  return (
    <AbsoluteFill style={{ backgroundColor: "#050510", overflow: "hidden" }}>
      <BackgroundLayer sections={sections} colorPalette={palette} />
      <MidgroundLayer sections={sections} colorPalette={palette} />

      <AbsoluteFill>
        <StatusBar source={source} color={palette.primary} />

        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={hookFrames}>
            <NotificationFrame
              emotion={emotionTarget}
              showBadge={Boolean(emotionTarget)}
              accentColor={palette.primary}
            >
              <HookSection
                hook={hook}
                emotionTarget={emotionTarget}
                emphasisWord={hookSection?.emphasisWord}
              />
            </NotificationFrame>
          </TransitionSeries.Sequence>
          <TransitionSeries.Transition
            presentation={fade()}
            timing={springTiming({
              config: { damping: 200 },
              durationInFrames: TRANSITION_FRAMES,
            })}
          />
          <TransitionSeries.Sequence durationInFrames={foreshadowFrames}>
            <NotificationFrame
              showBadge={false}
              accentColor={palette.accent}
            >
              <ForeshadowSection
                foreshadow={foreshadow}
                emphasisWord={foreshadowSection?.emphasisWord}
              />
            </NotificationFrame>
          </TransitionSeries.Sequence>
          {body.map((text, i) => {
            const badge = dataBadges?.find((d) => d.sectionIndex === i);
            const bodySection = sections.find((s) => s.name === `body_${i}`);
            return (
              <React.Fragment key={i}>
                <TransitionSeries.Transition
                  presentation={fade()}
                  timing={springTiming({
                    config: { damping: 200 },
                    durationInFrames: TRANSITION_FRAMES,
                  })}
                />
                <TransitionSeries.Sequence durationInFrames={bodyFrames[i] ?? 0}>
                  <BodySection
                    text={text}
                    index={i}
                    total={body.length}
                    componentHint={bodySection?.componentHint}
                    extractedNumber={bodySection?.extractedNumber}
                    numberPrefix={bodySection?.numberPrefix}
                    numberSuffix={bodySection?.numberSuffix}
                  />
                  {badge && <DataBadge value={badge.value} label={badge.label} />}
                </TransitionSeries.Sequence>
              </React.Fragment>
            );
          })}
          <TransitionSeries.Transition
            presentation={fade()}
            timing={springTiming({
              config: { damping: 200 },
              durationInFrames: TRANSITION_FRAMES,
            })}
          />
          <TransitionSeries.Sequence durationInFrames={closingFrames}>
            <ClosingScene
              lines={resolvedClosingLines}
              accentLineIndex={resolvedClosingAccentIndex}
              accentColor={palette.accent}
            />
          </TransitionSeries.Sequence>
        </TransitionSeries>

        <Sequence
          from={hookFrames}
          durationInFrames={durationInFrames - hookFrames}
        >
          <SourceBadge source={source} title={title} />
        </Sequence>

        {captions && captions.length > 0 && (
          <CaptionOverlay captions={captions} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

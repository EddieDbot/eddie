import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  CalculateMetadataFunction,
} from "remotion";
import { z } from "zod";
import { AnimatedText } from "../components/AnimatedText";
import { ProgressBar } from "../components/ProgressBar";

export const NewsShortSchema = z.object({
  hook: z.string(),
  foreshadow: z.string(),
  body: z.array(z.string()),
  payoff: z.string(),
  title: z.string(),
  source: z.string(),
  emotionTarget: z.enum(["LOL", "WTF", "OMG", "Wow", "Finally"]).optional(),
});

type Props = z.infer<typeof NewsShortSchema>;

const WORDS_PER_SEC = 2.5;
const MIN_HOOK_SEC = 4;
const MIN_FORESHADOW_SEC = 3;
const MIN_BODY_SEC = 3;
const MIN_PAYOFF_SEC = 2.5;

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
    0
  );
  const payoffSec = estimateSec(props.payoff, MIN_PAYOFF_SEC);
  const totalSec = hookSec + foreshadowSec + bodySec + payoffSec;
  return { durationInFrames: Math.ceil(totalSec * 30) };
};

// Animated grid background
const GridBackground: React.FC<{ frame: number }> = ({ frame }) => {
  const drift = interpolate(frame, [0, 1800], [0, 40], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, #0a0a2e 0%, #050510 60%, #020208 100%)",
        }}
      />
      <AbsoluteFill style={{ opacity: 0.12 }}>
        <svg
          width="1080"
          height="1920"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          <defs>
            <pattern
              id="grid"
              width="80"
              height="80"
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${drift % 80}, ${drift % 80})`}
            >
              <path
                d="M 80 0 L 0 0 0 80"
                fill="none"
                stroke="#00D4FF"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="1080" height="1920" fill="url(#grid)" />
        </svg>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: -200,
          left: "50%",
          transform: "translateX(-50%)",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(0,212,255,0.15) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -100,
          left: "30%",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(123,97,255,0.12) 0%, transparent 70%)",
          filter: "blur(50px)",
        }}
      />
    </AbsoluteFill>
  );
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

  const width = interpolate(progress, [0, 1], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        height: 2,
        width: `${width}%`,
        background: "linear-gradient(90deg, #00D4FF 0%, #7B61FF 100%)",
        boxShadow: "0 0 12px #00D4FF80",
        borderRadius: 1,
      }}
    />
  );
};

// Hook section — full screen impact title
const HookSection: React.FC<{
  hook: string;
  emotionTarget?: string;
  frame: number;
  fps: number;
}> = ({ hook, emotionTarget, frame, fps }) => {
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
                fontFamily: "system-ui, -apple-system, sans-serif",
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
          <AnimatedText
            text={hook}
            frame={frame}
            fps={fps}
            delay={4}
            color="#FFFFFF"
            fontSize={72}
            fontWeight={800}
          />
        </div>
        <GlowDivider frame={frame} fps={fps} delay={10} />
      </div>
    </AbsoluteFill>
  );
};

// Foreshadow section — teaser/mechanism
const ForeshadowSection: React.FC<{
  foreshadow: string;
  frame: number;
  fps: number;
}> = ({ foreshadow, frame, fps }) => {
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
              fontFamily: "system-ui, -apple-system, sans-serif",
              letterSpacing: "0.04em",
            }}
          >
            WHAT HAPPENS NEXT
          </span>
        </div>
        <AnimatedText
          text={foreshadow}
          frame={frame}
          fps={fps}
          delay={4}
          color="rgba(255,255,255,0.9)"
          fontSize={58}
          fontWeight={600}
        />
      </div>
    </AbsoluteFill>
  );
};

// Body sentence section
const BodySection: React.FC<{
  text: string;
  index: number;
  total: number;
  frame: number;
  fps: number;
}> = ({ text, index, total, frame, fps }) => {
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
        <AnimatedText
          text={text}
          frame={frame}
          fps={fps}
          delay={4}
          color="#FFFFFF"
          fontSize={54}
          fontWeight={700}
        />
      </div>
    </AbsoluteFill>
  );
};

// Payoff section — the reveal
const PayoffSection: React.FC<{
  payoff: string;
  frame: number;
  fps: number;
}> = ({ payoff, frame, fps }) => {
  const revealProgress = spring({
    frame,
    fps,
    config: { damping: 120, stiffness: 100 },
  });
  const scale = interpolate(revealProgress, [0, 1], [0.88, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(revealProgress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        paddingLeft: 64,
        paddingRight: 64,
        transform: `scale(${scale})`,
        opacity,
        boxSizing: "border-box",
      }}
    >
      <div style={{ width: "100%" }}>
        <div
          style={{
            height: 3,
            background: "linear-gradient(90deg, #7B61FF 0%, #00D4FF 100%)",
            boxShadow: "0 0 16px #7B61FF80",
            borderRadius: 2,
            marginBottom: 48,
          }}
        />
        <AnimatedText
          text={payoff}
          frame={frame}
          fps={fps}
          delay={3}
          color="#FFFFFF"
          fontSize={80}
          fontWeight={900}
        />
      </div>
    </AbsoluteFill>
  );
};

// Source badge
const SourceBadge: React.FC<{
  source: string;
  title: string;
  frame: number;
  fps: number;
}> = ({ source, title, frame, fps }) => {
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
            fontFamily: "system-ui, -apple-system, sans-serif",
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
          fontFamily: "system-ui, -apple-system, sans-serif",
          paddingRight: 4,
        }}
      >
        {title}
      </span>
    </div>
  );
};

export const NewsShort: React.FC<Props> = ({
  hook,
  foreshadow,
  body,
  payoff,
  title,
  source,
  emotionTarget,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const hookFrames = Math.ceil(estimateSec(hook, MIN_HOOK_SEC) * fps);
  const foreshadowFrames = Math.ceil(estimateSec(foreshadow, MIN_FORESHADOW_SEC) * fps);
  const bodyFrames = body.map((s) => Math.ceil(estimateSec(s, MIN_BODY_SEC) * fps));
  const payoffFrames = Math.ceil(estimateSec(payoff, MIN_PAYOFF_SEC) * fps);

  // Build offsets
  let cursor = 0;
  const hookFrom = cursor;
  cursor += hookFrames;
  const foreshadowFrom = cursor;
  cursor += foreshadowFrames;
  const bodyFroms = body.map((_, i) => {
    const from = cursor;
    cursor += bodyFrames[i] ?? 0;
    return from;
  });
  const payoffFrom = durationInFrames - payoffFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: "#050510", overflow: "hidden" }}>
      <GridBackground frame={frame} />
      <ProgressBar frame={frame} totalFrames={durationInFrames} color="#00D4FF" />

      <Sequence from={hookFrom} durationInFrames={hookFrames}>
        <HookSection
          hook={hook}
          emotionTarget={emotionTarget}
          frame={frame - hookFrom}
          fps={fps}
        />
      </Sequence>

      <Sequence from={foreshadowFrom} durationInFrames={foreshadowFrames}>
        <ForeshadowSection
          foreshadow={foreshadow}
          frame={frame - foreshadowFrom}
          fps={fps}
        />
      </Sequence>

      {body.map((text, i) => (
        <Sequence
          key={i}
          from={bodyFroms[i] ?? 0}
          durationInFrames={bodyFrames[i] ?? 0}
        >
          <BodySection
            text={text}
            index={i}
            total={body.length}
            frame={frame - (bodyFroms[i] ?? 0)}
            fps={fps}
          />
        </Sequence>
      ))}

      <Sequence from={payoffFrom} durationInFrames={payoffFrames}>
        <PayoffSection
          payoff={payoff}
          frame={frame - payoffFrom}
          fps={fps}
        />
      </Sequence>

      <Sequence
        from={hookFrames}
        durationInFrames={durationInFrames - hookFrames}
      >
        <SourceBadge
          source={source}
          title={title}
          frame={frame - hookFrames}
          fps={fps}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

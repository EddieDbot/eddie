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

const ScriptSectionSchema = z.object({
  text: z.string(),
  durationSec: z.number(),
  visual: z.string(),
});

export const NewsShortSchema = z.object({
  hook: z.string(),
  sections: z.array(ScriptSectionSchema),
  cta: z.string(),
  title: z.string(),
  source: z.string(),
});

type Props = z.infer<typeof NewsShortSchema>;
type Section = z.infer<typeof ScriptSectionSchema>;

export const calculateMetadata: CalculateMetadataFunction<Props> = ({
  props,
}) => {
  const hookSec = 3;
  const ctaSec = 3;
  const totalSec =
    props.sections.reduce((acc, s) => acc + s.durationSec, 0) +
    hookSec +
    ctaSec;
  return { durationInFrames: Math.ceil(totalSec * 30) };
};

// Animated grid background
const GridBackground: React.FC<{ frame: number }> = ({ frame }) => {
  const drift = interpolate(frame, [0, 1800], [0, 40], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* Base gradient */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, #0a0a2e 0%, #050510 60%, #020208 100%)",
        }}
      />

      {/* Animated grid SVG */}
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

      {/* Top glow orb */}
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

      {/* Bottom glow orb */}
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

// Glowing divider line
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
const HookSection: React.FC<{ hook: string; frame: number; fps: number }> = ({
  hook,
  frame,
  fps,
}) => {
  const bgProgress = spring({
    frame,
    fps,
    config: { damping: 300 },
  });

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
        {/* BREAKING label */}
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
              Breaking
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

        {/* Hook text */}
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

        {/* Divider */}
        <GlowDivider frame={frame} fps={fps} delay={10} />
      </div>
    </AbsoluteFill>
  );
};

// Individual content section
const ContentSection: React.FC<{
  section: Section;
  index: number;
  frame: number;
  fps: number;
  totalSections: number;
}> = ({ section, index, frame, fps, totalSections }) => {
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

  // Section indicator dots
  const dots = Array.from({ length: totalSections }, (_, i) => i);

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
      {/* Section number indicator */}
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
                i === index ? "#00D4FF" : "rgba(255,255,255,0.2)",
              boxShadow: i === index ? "0 0 8px #00D4FF" : "none",
              transition: "none",
            }}
          />
        ))}
      </div>

      {/* Main content card */}
      <div
        style={{
          transform: `translateY(${translateY}px)`,
          opacity,
        }}
      >
        {/* Visual hint badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            backgroundColor: "rgba(123, 97, 255, 0.15)",
            border: "1px solid rgba(123, 97, 255, 0.4)",
            borderRadius: 8,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 8,
            paddingBottom: 8,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "#7B61FF",
              marginRight: 10,
              boxShadow: "0 0 6px #7B61FF",
            }}
          />
          <span
            style={{
              color: "#7B61FF",
              fontSize: 24,
              fontWeight: 600,
              fontFamily: "system-ui, -apple-system, sans-serif",
            }}
          >
            {section.visual}
          </span>
        </div>

        {/* Section text */}
        <div
          style={{
            fontSize: 54,
            fontWeight: 700,
            color: "#FFFFFF",
            fontFamily:
              "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
            lineHeight: 1.4,
          }}
        >
          <AnimatedText
            text={section.text}
            frame={frame}
            fps={fps}
            delay={4}
            color="#FFFFFF"
            fontSize={54}
            fontWeight={700}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// CTA section
const CTASection: React.FC<{ cta: string; frame: number; fps: number }> = ({
  cta,
  frame,
  fps,
}) => {
  const pulseProgress = spring({
    frame,
    fps,
    config: { damping: 120, stiffness: 100 },
  });

  const scale = interpolate(pulseProgress, [0, 1], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = interpolate(pulseProgress, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Secondary pulse ring effect
  const ringPulse = interpolate(frame % 30, [0, 15, 30], [1, 1.06, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ringOpacity = interpolate(frame % 30, [0, 15, 30], [0.6, 0.2, 0.6], {
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
      <div style={{ textAlign: "center" }}>
        {/* Arrow icon */}
        <div
          style={{
            fontSize: 72,
            marginBottom: 32,
            transform: `scale(${ringPulse})`,
          }}
        >
          👆
        </div>

        {/* CTA button */}
        <div
          style={{
            position: "relative",
            display: "inline-block",
            marginBottom: 40,
          }}
        >
          {/* Pulse ring */}
          <div
            style={{
              position: "absolute",
              inset: -12,
              borderRadius: 20,
              border: "2px solid #00D4FF",
              opacity: ringOpacity,
              transform: `scale(${ringPulse})`,
            }}
          />
          {/* Button */}
          <div
            style={{
              backgroundColor: "#00D4FF",
              borderRadius: 16,
              paddingLeft: 56,
              paddingRight: 56,
              paddingTop: 24,
              paddingBottom: 24,
              boxShadow: "0 0 40px #00D4FF60",
            }}
          >
            <span
              style={{
                color: "#050510",
                fontSize: 44,
                fontWeight: 800,
                fontFamily: "system-ui, -apple-system, sans-serif",
                letterSpacing: "0.01em",
              }}
            >
              {cta}
            </span>
          </div>
        </div>

        {/* Subtext */}
        <div
          style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: 32,
            fontWeight: 400,
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          New AI news every day
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Source badge — always visible
const SourceBadge: React.FC<{
  source: string;
  title: string;
  frame: number;
  fps: number;
}> = ({ source, title, frame, fps }) => {
  const entryProgress = spring({
    frame,
    fps,
    config: { damping: 200 },
  });

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
  sections,
  cta,
  title,
  source,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const HOOK_SEC = 3;
  const CTA_SEC = 3;
  const HOOK_FRAMES = Math.ceil(HOOK_SEC * fps);
  const CTA_FRAMES = Math.ceil(CTA_SEC * fps);

  // Build cumulative frame offsets for each section
  const sectionOffsets: number[] = [];
  let cursor = HOOK_FRAMES;
  for (const section of sections) {
    sectionOffsets.push(cursor);
    cursor += Math.ceil(section.durationSec * fps);
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#050510", overflow: "hidden" }}>
      {/* Layer 0: Background (always rendered) */}
      <GridBackground frame={frame} />

      {/* Layer 1: Progress bar (always rendered) */}
      <ProgressBar
        frame={frame}
        totalFrames={durationInFrames}
        color="#00D4FF"
      />

      {/* Layer 2: Hook section */}
      <Sequence from={0} durationInFrames={HOOK_FRAMES}>
        <HookSection hook={hook} frame={frame - 0} fps={fps} />
      </Sequence>

      {/* Layer 3: Content sections */}
      {sections.map((section, i) => (
        <Sequence
          key={i}
          from={sectionOffsets[i]}
          durationInFrames={Math.ceil(section.durationSec * fps)}
        >
          <ContentSection
            section={section}
            index={i}
            frame={frame - sectionOffsets[i]}
            fps={fps}
            totalSections={sections.length}
          />
        </Sequence>
      ))}

      {/* Layer 4: CTA section */}
      <Sequence
        from={durationInFrames - CTA_FRAMES}
        durationInFrames={CTA_FRAMES}
      >
        <CTASection
          cta={cta}
          frame={frame - (durationInFrames - CTA_FRAMES)}
          fps={fps}
        />
      </Sequence>

      {/* Layer 5: Source badge (fades in after hook, stays visible) */}
      <Sequence
        from={HOOK_FRAMES}
        durationInFrames={durationInFrames - HOOK_FRAMES}
      >
        <SourceBadge
          source={source}
          title={title}
          frame={frame - HOOK_FRAMES}
          fps={fps}
        />
      </Sequence>
    </AbsoluteFill>
  );
};

import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { SPRING_PRESETS } from "../constants";

interface CountUpProps {
  to: number;
  from?: number;
  startFrame?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  separator?: string;
  decimals?: number;
  useSpring?: boolean;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
}

const formatNumber = (
  value: number,
  decimals: number,
  separator: string,
): string => {
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const safePart = intPart ?? "0";
  const isNegative = safePart.startsWith("-");
  const digits = isNegative ? safePart.slice(1) : safePart;

  const withSeparators = digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  const formatted = isNegative ? `-${withSeparators}` : withSeparators;

  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
};

export const CountUp: React.FC<CountUpProps> = ({
  to,
  from = 0,
  startFrame = 0,
  duration = 30,
  prefix = "",
  suffix = "",
  separator = ",",
  decimals = 0,
  useSpring: useSpringAnim = true,
  color = "#FFFFFF",
  fontSize = 72,
  fontWeight = 700,
  fontFamily = "Inter, sans-serif",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const adjustedFrame = Math.max(0, frame - startFrame);

  const progress = useSpringAnim
    ? spring({ frame: adjustedFrame, fps, config: SPRING_PRESETS.snappy })
    : interpolate(adjustedFrame, [0, duration], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  const current = from + (to - from) * Math.min(progress, 1);
  const formattedNumber = formatNumber(current, decimals, separator);

  return (
    <span
      style={{
        fontSize,
        fontWeight,
        color,
        fontFamily,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {prefix}
      {formattedNumber}
      {suffix}
    </span>
  );
};

interface CountUpWithLabelProps extends CountUpProps {
  label: string;
  labelPosition?: "top" | "bottom";
  labelColor?: string;
  labelFontSize?: number;
}

export const CountUpWithLabel: React.FC<CountUpWithLabelProps> = ({
  label,
  labelPosition = "bottom",
  labelColor = "rgba(255,255,255,0.7)",
  labelFontSize = 28,
  ...countUpProps
}) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: labelPosition === "top" ? "column-reverse" : "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <CountUp {...countUpProps} />
      <span
        style={{
          fontSize: labelFontSize,
          color: labelColor,
          fontFamily: countUpProps.fontFamily ?? "Inter, sans-serif",
          fontWeight: 500,
        }}
      >
        {label}
      </span>
    </div>
  );
};

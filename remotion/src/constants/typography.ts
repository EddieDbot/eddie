export const TYPOGRAPHY = {
  hero: {
    fontSize: 72,
    fontWeight: 700,
    lineHeight: 1.1,
  },
  title: {
    fontSize: 56,
    fontWeight: 600,
    lineHeight: 1.2,
  },
  body: {
    fontSize: 48,
    fontWeight: 400,
    lineHeight: 1.35,
  },
  code: {
    fontSize: 32,
    fontWeight: 400,
    fontFamily: 'JetBrains Mono, monospace',
    lineHeight: 1.5,
  },
  label: {
    fontSize: 28,
    fontWeight: 500,
    lineHeight: 1.2,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  },
  closing: {
    fontSize: 44,
    fontWeight: 600,
    lineHeight: 1.25,
    maxWidth: 860,
  },
  caption: {
    fontSize: 44,
    fontWeight: 700,
    lineHeight: 1.3,
  },
} as const;

export type TypographyVariant = keyof typeof TYPOGRAPHY;

export const MIN_FONT_SIZES: Record<TypographyVariant, number> = {
  hero: 56,
  title: 40,
  body: 36,
  code: 24,
  label: 22,
  closing: 36,
  caption: 36,
};

export const COLORS = {
  // EDDIE brand palette
  eddieCyan: '#00D4FF',
  eddiePurple: '#7B61FF',
  eddieGreen: '#00FF9D',
  eddieAmber: '#FFB300',

  // Semantic colors
  techBlue: '#3B82F6',
  insightOrange: '#F59E0B',
  solutionGreen: '#10B981',
  errorRed: '#EF4444',
  aiPurple: '#8B5CF6',
  historyGold: '#C9A227',
  neutralGray: '#6B7280',
  softWhite: '#F3F4F6',

  // Backgrounds
  dark: '#0A0A0F',
  surface: '#12121A',
  warm: '#140E08',
  cosmic: '#0B1120',
  light: '#F8FAFC',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.7)',
  textMuted: 'rgba(255,255,255,0.4)',
} as const;

export type ColorKey = keyof typeof COLORS;

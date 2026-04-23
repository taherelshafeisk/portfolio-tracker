// Direction D — Ledger × Coach design system
// Warm paper light theme

const colors = {
  // Paper backgrounds
  bg: '#F5F1EA',
  bgInset: '#EDE7DB',
  card: '#FBF8F2',

  // Ink (text)
  ink: '#15120C',
  ink2: '#4A453D',
  ink3: '#857D6F',

  // Dividers
  hair: 'rgba(21,18,12,0.08)',
  hair2: 'rgba(21,18,12,0.16)',

  // Accents
  accent: '#8B3A1F',       // sepia red — eyebrows, links
  gold: '#9A7A2E',
  goldSoft: 'rgba(154,122,46,0.12)',
  goldOnDeep: '#D4B26A',

  // Deep panels
  deep: '#15120C',
  deepInk: '#F0E7D0',
  deepInk2: '#B5AB92',
  deepHair: 'rgba(240,231,208,0.12)',

  // Signals
  positive: '#2D6A3F',
  positiveLight: 'rgba(45,106,63,0.12)',
  posOnDeep: '#8AC89A',
  negative: '#A82A1A',
  negativeLight: 'rgba(168,42,26,0.12)',
  negOnDeep: '#E5A394',
  amber: '#8C6A1A',
  amberLight: 'rgba(140,106,26,0.12)',
  amberOnDeep: '#E8B766',

  // Kept for legacy compatibility (mapped to new equivalents)
  primary: '#9A7A2E',
  background: '#F5F1EA',
  surface: '#FBF8F2',
  surfaceElevated: '#EDE7DB',
  surfaceBorder: 'rgba(21,18,12,0.16)',
  textPrimary: '#15120C',
  textSecondary: '#4A453D',
  textMuted: '#857D6F',
  separator: 'rgba(21,18,12,0.08)',
  tint: '#9A7A2E',
  tabIconDefault: '#857D6F',
  tabIconSelected: '#15120C',
  // Account type colors (kept for legacy compatibility)
  longTerm: '#7C4DFF',
  swing: '#FF9800',
  dayTrading: '#F50057',
  savings: '#00BFA5',
  neutral: '#857D6F',

  white: '#FFFFFF',
  black: '#000000',
};

export default {
  light: colors,
  dark: colors,
};

export { colors };

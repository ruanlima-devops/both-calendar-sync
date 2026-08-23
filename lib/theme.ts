export type VisualTheme = 'GOOGLE_STYLE' | 'MICROSOFT_STYLE';
export type ColorSchemePreference = 'system' | 'light' | 'dark';
export type ColorSchemeName = 'light' | 'dark';

export interface ThemeTokens {
  name: VisualTheme;
  scheme: ColorSchemeName;
  bg: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  dangerSurface: string;
  radius: number;
  pad: number;
  sidebar: boolean;
  density: 'comfortable' | 'compact';
}

const googleLight: Omit<ThemeTokens, 'name' | 'scheme'> = {
  bg: '#f8fafc',
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9',
  text: '#0f172a',
  muted: '#64748b',
  primary: '#2563eb',
  primaryText: '#ffffff',
  border: '#e2e8f0',
  success: '#059669',
  warning: '#d97706',
  danger: '#dc2626',
  dangerSurface: '#fef2f2',
  radius: 16,
  pad: 20,
  sidebar: false,
  density: 'comfortable',
};

const googleDark: Omit<ThemeTokens, 'name' | 'scheme'> = {
  bg: '#0b1220',
  surface: '#111827',
  surfaceMuted: '#1e293b',
  text: '#f8fafc',
  muted: '#94a3b8',
  primary: '#3b82f6',
  primaryText: '#ffffff',
  border: '#1f2937',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
  dangerSurface: '#3f1d1d',
  radius: 16,
  pad: 20,
  sidebar: false,
  density: 'comfortable',
};

const microsoftLight: Omit<ThemeTokens, 'name' | 'scheme'> = {
  bg: '#f3f2f1',
  surface: '#ffffff',
  surfaceMuted: '#faf9f8',
  text: '#111827',
  muted: '#605e5c',
  primary: '#0f6cbd',
  primaryText: '#ffffff',
  border: '#e1dfdd',
  success: '#107c10',
  warning: '#ca5010',
  danger: '#c50f1f',
  dangerSurface: '#fde7e9',
  radius: 4,
  pad: 12,
  sidebar: true,
  density: 'compact',
};

const microsoftDark: Omit<ThemeTokens, 'name' | 'scheme'> = {
  bg: '#141414',
  surface: '#1f1f1f',
  surfaceMuted: '#292929',
  text: '#f3f2f1',
  muted: '#a19f9d',
  primary: '#479ef5',
  primaryText: '#ffffff',
  border: '#3b3a39',
  success: '#6ccb5f',
  warning: '#ffb900',
  danger: '#ff6b6b',
  dangerSurface: '#442726',
  radius: 4,
  pad: 12,
  sidebar: true,
  density: 'compact',
};

function pack(name: VisualTheme, scheme: ColorSchemeName, base: Omit<ThemeTokens, 'name' | 'scheme'>): ThemeTokens {
  return { name, scheme, ...base };
}

export const googleTheme = pack('GOOGLE_STYLE', 'light', googleLight);
export const googleThemeDark = pack('GOOGLE_STYLE', 'dark', googleDark);
export const microsoftTheme = pack('MICROSOFT_STYLE', 'light', microsoftLight);
export const microsoftThemeDark = pack('MICROSOFT_STYLE', 'dark', microsoftDark);

export function resolveColorScheme(
  preference: ColorSchemePreference | null | undefined,
  system: ColorSchemeName,
): ColorSchemeName {
  if (preference === 'light' || preference === 'dark') return preference;
  return system;
}

export function themeTokens(
  visual: VisualTheme | null | undefined,
  scheme: ColorSchemeName = 'light',
): ThemeTokens {
  const isMicrosoft = visual === 'MICROSOFT_STYLE';
  if (scheme === 'dark') return isMicrosoft ? microsoftThemeDark : googleThemeDark;
  return isMicrosoft ? microsoftTheme : googleTheme;
}

export interface SchemeTokens {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  primaryText: string;
  border: string;
  danger: string;
  dangerMuted: string;
  hairline: string;
  googleButtonBg: string;
  googleButtonText: string;
  googleButtonBorder: string;
}

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const type = {
  pageTitle: 26,
  sectionTitle: 18,
  cardTitle: 16,
  body: 15,
  caption: 13,
  metadata: 12,
  brand: 13,
  title: 28,
  legal: 12,
  button: 16,
} as const;

export const layout = {
  authMaxWidth: 420,
  contentMaxWidth: 720,
  wideMaxWidth: 960,
  authButtonHeight: 52,
  logoMark: 36,
  tapTarget: 44,
} as const;

export const lightScheme: SchemeTokens = {
  bg: '#f8fafc',
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  primary: '#2563eb',
  primaryText: '#ffffff',
  border: '#e2e8f0',
  danger: '#b42318',
  dangerMuted: '#fef3f2',
  hairline: '#e2e8f0',
  googleButtonBg: '#ffffff',
  googleButtonText: '#1f1f1f',
  googleButtonBorder: '#dadce0',
};

export const darkScheme: SchemeTokens = {
  bg: '#0b1220',
  surface: '#111827',
  text: '#f8fafc',
  muted: '#94a3b8',
  primary: '#3b82f6',
  primaryText: '#ffffff',
  border: '#1f2937',
  danger: '#fca5a5',
  dangerMuted: '#3f1d1d',
  hairline: '#1f2937',
  googleButtonBg: '#131314',
  googleButtonText: '#e3e3e3',
  googleButtonBorder: '#8e918f',
};

export function schemeTokens(scheme: ColorSchemeName): SchemeTokens {
  return scheme === 'dark' ? darkScheme : lightScheme;
}

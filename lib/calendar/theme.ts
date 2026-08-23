import type { ThemeTokens, VisualTheme } from '@/lib/theme';
import type { CalendarStyleTokens, CalendarVisualStyle } from '@/lib/calendar/types';

export function calendarStyleFromVisual(visual: VisualTheme | null | undefined): CalendarVisualStyle {
  return visual === 'MICROSOFT_STYLE' ? 'microsoft' : 'google';
}

export function calendarStyleTokens(
  style: CalendarVisualStyle,
  theme: ThemeTokens,
): CalendarStyleTokens {
  if (style === 'microsoft') {
    return {
      style: 'microsoft',
      hourHeight: 44,
      timeGutterWidth: 56,
      eventRadius: 2,
      eventGap: 1,
      minEventHeight: 22,
      gridLine: theme.border,
      gridLineStrong: theme.muted + '55',
      headerBg: theme.surface,
      todayCircle: theme.primary,
      todayCircleText: theme.primaryText,
      nowLine: '#c50f1f',
      allDayBg: theme.surfaceMuted,
      weekendMuted: theme.muted,
      dense: true,
    };
  }

  return {
    style: 'google',
    hourHeight: 52,
    timeGutterWidth: 64,
    eventRadius: 6,
    eventGap: 2,
    minEventHeight: 20,
    gridLine: theme.border,
    gridLineStrong: theme.border,
    headerBg: theme.bg,
    todayCircle: theme.primary,
    todayCircleText: theme.primaryText,
    nowLine: theme.primary,
    allDayBg: theme.bg,
    weekendMuted: theme.muted,
    dense: false,
  };
}

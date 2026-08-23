export type CalendarVisualStyle = 'google' | 'microsoft';
export type CalendarViewMode = 'day' | 'week' | 'month';

export interface CalendarStyleTokens {
  style: CalendarVisualStyle;
  hourHeight: number;
  timeGutterWidth: number;
  eventRadius: number;
  eventGap: number;
  minEventHeight: number;
  gridLine: string;
  gridLineStrong: string;
  headerBg: string;
  todayCircle: string;
  todayCircleText: string;
  nowLine: string;
  allDayBg: string;
  weekendMuted: string;
  dense: boolean;
}

export interface TimedLayoutItem {
  eventId: string;
  column: number;
  columnCount: number;
  top: number;
  height: number;
  startMin: number;
  endMin: number;
}

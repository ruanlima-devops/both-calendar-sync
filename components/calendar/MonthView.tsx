import { Pressable, Text, View } from 'react-native';
import { Typography } from '@/components/ui/Typography';
import { dayOfMonth, daysInMonthGrid, isSameMonth, todayKey } from '@/lib/calendar/ranges';
import type { CalendarStyleTokens } from '@/lib/calendar/types';
import type { ThemeTokens } from '@/lib/theme';
import type { UnifiedEvent } from '@/lib/types';

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export function MonthView({
  anchor,
  eventsByDay,
  timeZone,
  theme,
  tokens,
  onSelectDay,
  onPressEvent,
  onShowMore,
}: {
  anchor: string;
  eventsByDay: Map<string, UnifiedEvent[]>;
  timeZone: string;
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
  onSelectDay: (day: string) => void;
  onPressEvent: (event: UnifiedEvent) => void;
  onShowMore: (day: string) => void;
}) {
  const days = daysInMonthGrid(anchor, timeZone);
  const today = todayKey(timeZone);
  const maxVisible = tokens.dense ? 3 : 4;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: tokens.gridLine, paddingVertical: 8 }}>
        {WEEKDAYS.map((label) => (
          <View key={label} style={{ flex: 1, alignItems: 'center' }}>
            <Typography variant="metadata" muted>
              {label}
            </Typography>
          </View>
        ))}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap' }}>
        {days.map((day) => {
          const inMonth = isSameMonth(day, anchor);
          const dayEvents = eventsByDay.get(day) ?? [];
          const visible = dayEvents.slice(0, maxVisible);
          const overflow = dayEvents.length - visible.length;
          const isToday = day === today;

          return (
            <Pressable
              key={day}
              onPress={() => onSelectDay(day)}
              style={{
                width: '14.2857%',
                minHeight: tokens.dense ? 96 : 110,
                borderRightWidth: 1,
                borderBottomWidth: 1,
                borderColor: tokens.gridLine,
                padding: 4,
                backgroundColor: inMonth ? theme.surface : theme.bg,
                opacity: inMonth ? 1 : 0.55,
              }}
            >
              <View
                style={{
                  alignSelf: 'flex-start',
                  width: 24,
                  height: 24,
                  borderRadius: tokens.style === 'google' ? 12 : tokens.eventRadius,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isToday ? tokens.todayCircle : 'transparent',
                  marginBottom: 2,
                }}
              >
                <Text style={{ color: isToday ? tokens.todayCircleText : theme.text, fontSize: 12, fontWeight: '600' }}>
                  {dayOfMonth(day)}
                </Text>
              </View>
              {visible.map((event) => (
                <Pressable
                  key={event.id}
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onPressEvent(event);
                  }}
                  style={{
                    backgroundColor: event.calendars[0]?.color ?? theme.primary,
                    borderRadius: tokens.eventRadius,
                    paddingHorizontal: 4,
                    paddingVertical: 1,
                    marginBottom: 2,
                  }}
                >
                  <Text numberOfLines={1} style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
                    {event.title || '(sem título)'}
                  </Text>
                </Pressable>
              ))}
              {overflow > 0 ? (
                <Pressable onPress={() => onShowMore(day)}>
                  <Text style={{ color: theme.primary, fontSize: 10, fontWeight: '600' }}>+{overflow}</Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

import { Pressable, Text, View } from 'react-native';
import { Typography } from '@/components/ui/Typography';
import {
  dayOfMonth,
  daysInMonthGrid,
  isSameMonth,
  monthLabel,
  startOfMonthKey,
  todayKey,
} from '@/lib/calendar/ranges';
import type { CalendarStyleTokens } from '@/lib/calendar/types';
import type { ThemeTokens } from '@/lib/theme';
import { space } from '@/lib/theme';

export function MiniCalendar({
  anchor,
  selected,
  rangeDays,
  timeZone,
  theme,
  tokens,
  onSelectDay,
  onShiftMonth,
}: {
  anchor: string;
  selected: string;
  rangeDays: string[];
  timeZone: string;
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
  onSelectDay: (day: string) => void;
  onShiftMonth: (amount: number) => void;
}) {
  const monthAnchor = startOfMonthKey(anchor);
  const days = daysInMonthGrid(monthAnchor, timeZone);
  const today = todayKey(timeZone);
  const inRange = new Set(rangeDays);

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => onShiftMonth(-1)} accessibilityLabel="Mês anterior" style={{ padding: 6 }}>
          <Text style={{ color: theme.text }}>‹</Text>
        </Pressable>
        <Typography variant="caption">{monthLabel(monthAnchor, timeZone)}</Typography>
        <Pressable onPress={() => onShiftMonth(1)} accessibilityLabel="Próximo mês" style={{ padding: 6 }}>
          <Text style={{ color: theme.text }}>›</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
          <View key={`${d}-${i}`} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ color: theme.muted, fontSize: 10 }}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {days.map((day) => {
          const selectedDay = day === selected;
          const todayDay = day === today;
          const highlighted = inRange.has(day);
          return (
            <Pressable
              key={day}
              onPress={() => onSelectDay(day)}
              style={{
                width: '14.2857%',
                aspectRatio: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: tokens.style === 'google' ? 14 : tokens.eventRadius,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selectedDay
                    ? tokens.todayCircle
                    : highlighted
                      ? theme.surfaceMuted
                      : 'transparent',
                  borderWidth: todayDay && !selectedDay ? 1 : 0,
                  borderColor: theme.primary,
                  opacity: isSameMonth(day, monthAnchor) ? 1 : 0.35,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: selectedDay || todayDay ? '700' : '400',
                    color: selectedDay ? tokens.todayCircleText : theme.text,
                  }}
                >
                  {dayOfMonth(day)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

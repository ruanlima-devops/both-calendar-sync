import { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Typography } from '@/components/ui/Typography';
import { formatMinutes, layoutTimedEvents } from '@/lib/calendar/layout';
import { dayOfMonth, nowMinutes, todayKey, weekdayShort } from '@/lib/calendar/ranges';
import type { CalendarStyleTokens } from '@/lib/calendar/types';
import type { ThemeTokens } from '@/lib/theme';
import type { UnifiedEvent } from '@/lib/types';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function TimeGrid({
  days,
  eventsByDay,
  timeZone,
  theme,
  tokens,
  onPressEvent,
  onPressSlot,
  showDayHeaders,
}: {
  days: string[];
  eventsByDay: Map<string, UnifiedEvent[]>;
  timeZone: string;
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
  onPressEvent: (event: UnifiedEvent) => void;
  onPressSlot?: (day: string, hour: number) => void;
  showDayHeaders?: boolean;
}) {
  const today = todayKey(timeZone);
  const nowMin = nowMinutes(timeZone);
  const gridHeight = 24 * tokens.hourHeight;
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const y = Math.max(0, (nowMin / 60) * tokens.hourHeight - tokens.hourHeight * 2);
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [days.join('|'), tokens.hourHeight, nowMin]);

  return (
    <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ minHeight: gridHeight + 80 }}>
      <AllDayRow
        days={days}
        eventsByDay={eventsByDay}
        theme={theme}
        tokens={tokens}
        timeZone={timeZone}
        onPressEvent={onPressEvent}
      />
      {showDayHeaders !== false ? (
        <DayHeaders days={days} today={today} timeZone={timeZone} theme={theme} tokens={tokens} />
      ) : null}
      <View style={{ flexDirection: 'row', height: gridHeight }}>
        <View style={{ width: tokens.timeGutterWidth }}>
          {HOURS.map((hour) => (
            <View key={hour} style={{ height: tokens.hourHeight, justifyContent: 'flex-start' }}>
              <Text
                style={{
                  color: theme.muted,
                  fontSize: tokens.dense ? 11 : 12,
                  marginTop: -7,
                  textAlign: 'right',
                  paddingRight: 8,
                }}
              >
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}:00`}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {days.map((day) => (
            <DayColumn
              key={day}
              day={day}
              today={today}
              events={eventsByDay.get(day) ?? []}
              timeZone={timeZone}
              theme={theme}
              tokens={tokens}
              nowMin={nowMin}
              onPressEvent={onPressEvent}
              onPressSlot={onPressSlot}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function DayHeaders({
  days,
  today,
  timeZone,
  theme,
  tokens,
}: {
  days: string[];
  today: string;
  timeZone: string;
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
}) {
  return (
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: tokens.gridLine }}>
      <View style={{ width: tokens.timeGutterWidth }} />
      {days.map((day) => {
        const isToday = day === today;
        return (
          <View key={day} style={{ flex: 1, alignItems: 'center', paddingVertical: tokens.dense ? 8 : 12 }}>
            <Typography variant="metadata" muted style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {weekdayShort(day, timeZone)}
            </Typography>
            <View
              style={{
                marginTop: 4,
                width: tokens.style === 'google' ? 36 : 28,
                height: tokens.style === 'google' ? 36 : 28,
                borderRadius: tokens.style === 'google' ? 18 : tokens.eventRadius,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isToday ? tokens.todayCircle : 'transparent',
              }}
            >
              <Text
                style={{
                  color: isToday ? tokens.todayCircleText : theme.text,
                  fontWeight: '700',
                  fontSize: tokens.dense ? 14 : 18,
                }}
              >
                {dayOfMonth(day)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function AllDayRow({
  days,
  eventsByDay,
  theme,
  tokens,
  timeZone,
  onPressEvent,
}: {
  days: string[];
  eventsByDay: Map<string, UnifiedEvent[]>;
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
  timeZone: string;
  onPressEvent: (event: UnifiedEvent) => void;
}) {
  const hasAny = days.some((d) => (eventsByDay.get(d) ?? []).some((e) => e.all_day));
  if (!hasAny) return null;

  return (
    <View
      style={{
        flexDirection: 'row',
        borderBottomWidth: 1,
        borderBottomColor: tokens.gridLine,
        backgroundColor: tokens.allDayBg,
        minHeight: 36,
      }}
    >
      <View style={{ width: tokens.timeGutterWidth, justifyContent: 'center', paddingRight: 6 }}>
        <Text style={{ color: theme.muted, fontSize: 10, textAlign: 'right' }}>Dia inteiro</Text>
      </View>
      {days.map((day) => {
        const allDay = (eventsByDay.get(day) ?? []).filter((e) => e.all_day);
        return (
          <View key={day} style={{ flex: 1, padding: 2, gap: 2, borderLeftWidth: 1, borderLeftColor: tokens.gridLine }}>
            {allDay.map((event) => (
              <Pressable
                key={event.id}
                onPress={() => onPressEvent(event)}
                style={{
                  backgroundColor: event.calendars[0]?.color ?? theme.primary,
                  borderRadius: tokens.eventRadius,
                  paddingHorizontal: 6,
                  paddingVertical: 3,
                }}
              >
                <Text numberOfLines={1} style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>
                  {event.title || '(sem título)'}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function DayColumn({
  day,
  today,
  events,
  timeZone,
  theme,
  tokens,
  nowMin,
  onPressEvent,
  onPressSlot,
}: {
  day: string;
  today: string;
  events: UnifiedEvent[];
  timeZone: string;
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
  nowMin: number;
  onPressEvent: (event: UnifiedEvent) => void;
  onPressSlot?: (day: string, hour: number) => void;
}) {
  const timed = useMemo(
    () => layoutTimedEvents(events, day, timeZone, tokens.hourHeight, tokens.minEventHeight),
    [events, day, timeZone, tokens.hourHeight, tokens.minEventHeight],
  );
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const isToday = day === today;

  return (
    <View
      style={{
        flex: 1,
        borderLeftWidth: 1,
        borderLeftColor: tokens.gridLine,
        backgroundColor: isToday && tokens.style === 'microsoft' ? theme.surfaceMuted : 'transparent',
      }}
    >
      {HOURS.map((hour) => (
        <Pressable
          key={hour}
          onPress={() => onPressSlot?.(day, hour)}
          accessibilityLabel={`Criar evento às ${String(hour).padStart(2, '0')}:00`}
          style={{
            height: tokens.hourHeight,
            borderTopWidth: 1,
            borderTopColor: hour % 2 === 0 ? tokens.gridLineStrong : tokens.gridLine,
          }}
        />
      ))}
      {isToday ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: (nowMin / 60) * tokens.hourHeight,
            height: 2,
            backgroundColor: tokens.nowLine,
            zIndex: 3,
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: -4,
              top: -3,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: tokens.nowLine,
            }}
          />
        </View>
      ) : null}
      {timed.map((item) => {
        const event = byId.get(item.eventId);
        if (!event) return null;
        const widthPct = 100 / item.columnCount;
        const leftPct = widthPct * item.column;
        const color = event.calendars[0]?.color ?? theme.primary;
        return (
          <Pressable
            key={item.eventId}
            onPress={() => onPressEvent(event)}
            accessibilityLabel={event.title ?? 'Evento'}
            style={{
              position: 'absolute',
              top: item.top,
              height: item.height,
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              paddingRight: tokens.eventGap,
              zIndex: 2,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: tokens.style === 'google' ? color + '26' : color,
                borderLeftWidth: tokens.style === 'google' ? 3 : 0,
                borderLeftColor: color,
                borderRadius: tokens.eventRadius,
                paddingHorizontal: 5,
                paddingVertical: 2,
                overflow: 'hidden',
              }}
            >
              <Text
                numberOfLines={item.height < 36 ? 1 : 2}
                style={{
                  color: tokens.style === 'google' ? theme.text : '#fff',
                  fontSize: tokens.dense ? 11 : 12,
                  fontWeight: '600',
                }}
              >
                {event.title || '(sem título)'}
              </Text>
              {item.height >= 36 ? (
                <Text
                  numberOfLines={1}
                  style={{ color: tokens.style === 'google' ? theme.muted : '#ffffffcc', fontSize: 10, marginTop: 1 }}
                >
                  {formatMinutes(item.startMin)}–{formatMinutes(item.endMin)}
                </Text>
              ) : null}
              {item.height >= 52 && event.location ? (
                <Text numberOfLines={1} style={{ color: tokens.style === 'google' ? theme.muted : '#ffffffaa', fontSize: 10 }}>
                  {event.location}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

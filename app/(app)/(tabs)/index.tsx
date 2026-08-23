import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarSidebar } from '@/components/calendar/CalendarSidebar';
import { CalendarToolbar } from '@/components/calendar/CalendarToolbar';
import { DayAgenda } from '@/components/calendar/DayAgenda';
import { MiniCalendar } from '@/components/calendar/MiniCalendar';
import { MonthView } from '@/components/calendar/MonthView';
import { TimeGrid } from '@/components/calendar/TimeGrid';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import {
  daysInMonthGrid,
  daysInWeek,
  headerLabel,
  shiftAnchor,
  startOfMonthKey,
  todayKey,
  utcRangeForView,
} from '@/lib/calendar/ranges';
import { calendarStyleFromVisual, calendarStyleTokens } from '@/lib/calendar/theme';
import type { CalendarViewMode } from '@/lib/calendar/types';
import { eventOverlapsDay } from '@/lib/dates';
import { groupEvents } from '@/lib/events';
import { invokeFunction, supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import type { CalendarConnection, CalendarEvent, ConnectedCalendar, UnifiedEvent } from '@/lib/types';

export default function AgendaScreen() {
  const { profile, session, theme } = useSession();
  const router = useRouter();
  const tz = profile?.timezone ?? 'UTC';
  const locale = profile?.locale ?? 'pt-BR';
  const { day: dayParam } = useLocalSearchParams<{ day?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= 960;
  const isTablet = width >= 720;

  const style = calendarStyleFromVisual(profile?.visual_theme);
  const tokens = useMemo(() => calendarStyleTokens(style, theme), [style, theme]);

  const [anchor, setAnchor] = useState(todayKey(tz));
  const [view, setView] = useState<CalendarViewMode>('week');
  const [viewReady, setViewReady] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem('unify.calendarView').then((stored) => {
      if (stored === 'day' || stored === 'week' || stored === 'month') setView(stored);
      setViewReady(true);
    });
  }, []);

  useEffect(() => {
    if (!viewReady) return;
    void AsyncStorage.setItem('unify.calendarView', view);
  }, [view, viewReady]);

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<ConnectedCalendar[]>([]);
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [moreDay, setMoreDay] = useState<string | null>(null);
  const [miniMonth, setMiniMonth] = useState(startOfMonthKey(todayKey(tz)));

  useEffect(() => {
    if (typeof dayParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
      setAnchor(dayParam);
      setMiniMonth(startOfMonthKey(dayParam));
    }
  }, [dayParam]);

  const load = useCallback(async () => {
    const { from, to } = utcRangeForView(anchor, view, tz);
    const [{ data: ev }, { data: cals }, { data: cons }] = await Promise.all([
      supabase
        .from('calendar_events')
        .select('*')
        .gte('start_at', from)
        .lt('start_at', to)
        .neq('status', 'cancelled'),
      supabase.from('connected_calendars').select('*'),
      supabase.from('calendar_connections').select('*'),
    ]);
    setEvents((ev ?? []) as CalendarEvent[]);
    setCalendars((cals ?? []) as ConnectedCalendar[]);
    setConnections((cons ?? []) as CalendarConnection[]);
  }, [anchor, view, tz]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    void invokeFunction('sync-now', { ensureWatchesOnly: true }).catch((err) => {
      console.warn('[unify] ensure watches', err instanceof Error ? err.message : err);
    });
  }, []);

  useEffect(() => {
    const filter = session?.user.id ? { filter: `user_id=eq.${session.user.id}` } : {};
    const channel = supabase
      .channel('events-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events', ...filter }, () => void load())
      .subscribe();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      void supabase.removeChannel(channel);
      sub.remove();
    };
  }, [load, session?.user.id]);

  const visibleCalendars = useMemo(
    () => calendars.filter((c) => c.enabled && !hiddenIds.has(c.id)),
    [calendars, hiddenIds],
  );

  const unified = useMemo(
    () => groupEvents(events, visibleCalendars, connections),
    [events, visibleCalendars, connections],
  );

  const weekDays = useMemo(() => daysInWeek(anchor, tz), [anchor, tz]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, UnifiedEvent[]>();
    const days = view === 'month' ? daysInMonthGrid(anchor, tz) : view === 'day' ? [anchor] : weekDays;
    for (const day of days) {
      map.set(
        day,
        unified.filter((e) => eventOverlapsDay(e.start_at, e.end_at, e.all_day, day, tz)),
      );
    }
    return map;
  }, [unified, view, anchor, tz, weekDays]);

  const title = headerLabel(anchor, view, tz, locale);

  function openEvent(event: UnifiedEvent) {
    router.push(`/(app)/event/${event.id}`);
  }

  function openCreate(opts?: { date?: string; start?: string; end?: string; allDay?: boolean }) {
    const q = new URLSearchParams();
    if (opts?.date) q.set('date', opts.date);
    if (opts?.start) q.set('start', opts.start);
    if (opts?.end) q.set('end', opts.end);
    if (opts?.allDay) q.set('allDay', '1');
    const qs = q.toString();
    router.push(`/(app)/event/new${qs ? `?${qs}` : ''}`);
  }

  function toggleHidden(calendarId: string) {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(calendarId)) next.delete(calendarId);
      else next.add(calendarId);
      return next;
    });
  }

  const moreEvents = moreDay
    ? unified.filter((e) => eventOverlapsDay(e.start_at, e.end_at, e.all_day, moreDay, tz))
    : [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <CalendarToolbar
        theme={theme}
        tokens={tokens}
        title={title}
        view={view}
        onViewChange={setView}
        onPrev={() => {
          const next = shiftAnchor(anchor, view, -1);
          setAnchor(next);
          setMiniMonth(startOfMonthKey(next));
        }}
        onNext={() => {
          const next = shiftAnchor(anchor, view, 1);
          setAnchor(next);
          setMiniMonth(startOfMonthKey(next));
        }}
        onToday={() => {
          const today = todayKey(tz);
          setAnchor(today);
          setMiniMonth(startOfMonthKey(today));
        }}
      />

      <View style={{ flex: 1, flexDirection: isWide ? 'row' : 'column' }}>
        {isWide ? (
          <View
            style={{
              width: tokens.dense ? 240 : 260,
              borderRightWidth: 1,
              borderRightColor: tokens.gridLine,
              backgroundColor: theme.surface,
              padding: space.md,
              gap: space.lg,
            }}
          >
            <MiniCalendar
              anchor={miniMonth}
              selected={anchor}
              rangeDays={view === 'week' ? weekDays : view === 'day' ? [anchor] : []}
              timeZone={tz}
              theme={theme}
              tokens={tokens}
              onSelectDay={(day) => {
                setAnchor(day);
                if (view === 'month') setView('day');
              }}
              onShiftMonth={(amount) => {
                const next = shiftAnchor(miniMonth, 'month', amount);
                setMiniMonth(startOfMonthKey(next));
              }}
            />
            <CalendarSidebar
              connections={connections}
              calendars={calendars}
              hiddenIds={hiddenIds}
              theme={theme}
              tokens={tokens}
              onToggle={toggleHidden}
            />
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          {view === 'month' ? (
            <MonthView
              anchor={anchor}
              eventsByDay={eventsByDay}
              timeZone={tz}
              theme={theme}
              tokens={tokens}
              onSelectDay={(day) => openCreate({ date: day, allDay: true })}
              onPressEvent={openEvent}
              onShowMore={setMoreDay}
            />
          ) : view === 'day' && !isTablet ? (
            <DayAgenda
              events={eventsByDay.get(anchor) ?? []}
              timeZone={tz}
              onPress={openEvent}
              onConnect={() => router.push('/(app)/(tabs)/calendars')}
            />
          ) : (
            <ScrollView
              horizontal={!isTablet && view === 'week'}
              style={{ flex: 1 }}
              contentContainerStyle={!isTablet && view === 'week' ? { minWidth: 7 * 120 } : { flexGrow: 1 }}
            >
              <View style={{ flex: 1, minWidth: !isTablet && view === 'week' ? 7 * 120 : undefined }}>
                <TimeGrid
                  days={view === 'day' ? [anchor] : weekDays}
                  eventsByDay={eventsByDay}
                  timeZone={tz}
                  theme={theme}
                  tokens={tokens}
                  onPressEvent={openEvent}
                  onPressSlot={(day, hour) => {
                    const start = `${String(hour).padStart(2, '0')}:00`;
                    const endHour = Math.min(23, hour + 1);
                    const end = `${String(endHour).padStart(2, '0')}:00`;
                    openCreate({ date: day, start, end });
                  }}
                  showDayHeaders={view === 'week' || (view === 'day' && isTablet)}
                />
              </View>
            </ScrollView>
          )}
        </View>
      </View>

      <Pressable
        onPress={() => openCreate({ date: anchor })}
        accessibilityLabel="Novo evento"
        style={{
          position: 'absolute',
          right: 20,
          bottom: 24,
          backgroundColor: theme.primary,
          width: 56,
          height: 56,
          borderRadius: tokens.style === 'google' ? 28 : 8,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        <Text style={{ color: theme.primaryText, fontSize: 28, lineHeight: 30 }}>+</Text>
      </Pressable>

      <Modal visible={Boolean(moreDay)} transparent animationType="fade" onRequestClose={() => setMoreDay(null)}>
        <Pressable
          style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'center', padding: 24 }}
          onPress={() => setMoreDay(null)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation?.()}
            style={{
              backgroundColor: theme.surface,
              borderRadius: theme.radius,
              padding: 16,
              maxHeight: '70%',
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Typography variant="sectionTitle">Eventos · {moreDay}</Typography>
            <ScrollView style={{ marginTop: 12 }}>
              <DayAgenda events={moreEvents} timeZone={tz} onPress={openEvent} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

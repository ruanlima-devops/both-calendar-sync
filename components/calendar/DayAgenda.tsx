import { Pressable, ScrollView, View } from 'react-native';
import { EmptyState } from '@/components/ui/EmptyState';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { formatRange } from '@/lib/dates';
import type { UnifiedEvent } from '@/lib/types';

export function DayAgenda({
  events,
  timeZone,
  onPress,
  onConnect,
}: {
  events: UnifiedEvent[];
  timeZone: string;
  onPress: (event: UnifiedEvent) => void;
  onConnect?: () => void;
}) {
  const { theme } = useSession();

  if (events.length === 0) {
    return (
      <EmptyState
        title="Nenhum evento por aqui"
        description="Conecte uma agenda ou crie um compromisso para começar a organizar seu dia."
        actionLabel={onConnect ? 'Conectar calendário' : undefined}
        onAction={onConnect}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 96 }}>
      {events.map((event) => {
        const isNow = !event.all_day && new Date(event.end_at) >= new Date() && new Date(event.start_at) <= new Date();
        return (
          <Pressable
            key={event.id}
            onPress={() => onPress(event)}
            style={{
              backgroundColor: theme.surface,
              borderRadius: theme.radius,
              padding: theme.pad,
              borderLeftWidth: 4,
              borderLeftColor: event.calendars[0]?.color ?? theme.primary,
              borderWidth: 1,
              borderColor: isNow ? theme.primary : theme.border,
            }}
          >
            <Typography variant="cardTitle">{event.title || '(sem título)'}</Typography>
            <Typography variant="caption" muted style={{ marginTop: 4 }}>
              {formatRange(event.start_at, event.end_at, timeZone, event.all_day)}
            </Typography>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {event.calendars.map((cal) => (
                <View key={cal.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cal.color }} />
                  <Typography variant="metadata" muted>
                    {cal.name}
                  </Typography>
                </View>
              ))}
              {event.calendars.length > 1 ? (
                <Typography variant="metadata" style={{ color: theme.primary }}>
                  Bloqueado em {event.calendars.length} agendas
                </Typography>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

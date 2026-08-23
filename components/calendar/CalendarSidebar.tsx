import { Pressable, ScrollView, View } from 'react-native';
import { Typography } from '@/components/ui/Typography';
import type { CalendarStyleTokens } from '@/lib/calendar/types';
import type { ThemeTokens } from '@/lib/theme';
import { space } from '@/lib/theme';
import type { CalendarConnection, ConnectedCalendar } from '@/lib/types';

export function CalendarSidebar({
  connections,
  calendars,
  hiddenIds,
  theme,
  tokens,
  onToggle,
}: {
  connections: CalendarConnection[];
  calendars: ConnectedCalendar[];
  hiddenIds: Set<string>;
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
  onToggle: (calendarId: string) => void;
}) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
      <Typography variant="caption" muted style={{ textTransform: tokens.style === 'google' ? 'none' : 'uppercase' }}>
        Minhas agendas
      </Typography>
      {connections.map((conn) => {
        const group = calendars.filter((c) => c.connection_id === conn.id);
        if (group.length === 0) return null;
        return (
          <View key={conn.id} style={{ gap: space.xs }}>
            <Typography variant="cardTitle">
              {conn.provider === 'GOOGLE' ? 'Google' : 'Microsoft'}
            </Typography>
            {group.map((cal) => {
              const visible = !hiddenIds.has(cal.id);
              return (
                <Pressable
                  key={cal.id}
                  onPress={() => onToggle(cal.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: visible }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 6,
                  }}
                >
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: tokens.style === 'google' ? 3 : 2,
                      borderWidth: visible ? 0 : 1,
                      borderColor: theme.border,
                      backgroundColor: visible ? cal.color : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {visible ? (
                      <Typography variant="metadata" style={{ color: '#fff', fontSize: 10, lineHeight: 12 }}>
                        ✓
                      </Typography>
                    ) : null}
                  </View>
                  <Typography variant="body" numberOfLines={1} style={{ flex: 1 }}>
                    {cal.name}
                  </Typography>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

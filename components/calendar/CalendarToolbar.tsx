import { Pressable, Text, View } from 'react-native';
import { Typography } from '@/components/ui/Typography';
import type { CalendarStyleTokens, CalendarViewMode } from '@/lib/calendar/types';
import type { ThemeTokens } from '@/lib/theme';
import { space } from '@/lib/theme';

const VIEWS: Array<{ id: CalendarViewMode; label: string }> = [
  { id: 'day', label: 'Dia' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mês' },
];

export function CalendarToolbar({
  theme,
  tokens,
  title,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
}: {
  theme: ThemeTokens;
  tokens: CalendarStyleTokens;
  title: string;
  view: CalendarViewMode;
  onViewChange: (view: CalendarViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const compact = tokens.dense;

  return (
    <View
      style={{
        paddingHorizontal: compact ? space.md : space.lg,
        paddingVertical: compact ? space.sm : space.md,
        borderBottomWidth: 1,
        borderBottomColor: tokens.gridLine,
        backgroundColor: tokens.headerBg,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Pressable
            onPress={onToday}
            accessibilityLabel="Hoje"
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: tokens.eventRadius,
              borderWidth: 1,
              borderColor: theme.border,
              minHeight: 36,
              justifyContent: 'center',
            }}
          >
            <Typography variant="caption">Hoje</Typography>
          </Pressable>
          <Pressable onPress={onPrev} accessibilityLabel="Anterior" style={{ padding: 8, minWidth: 36, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 18 }}>‹</Text>
          </Pressable>
          <Pressable onPress={onNext} accessibilityLabel="Próximo" style={{ padding: 8, minWidth: 36, alignItems: 'center' }}>
            <Text style={{ color: theme.text, fontSize: 18 }}>›</Text>
          </Pressable>
          <Typography variant={compact ? 'cardTitle' : 'sectionTitle'} style={{ marginLeft: 4 }}>
            {title}
          </Typography>
        </View>

        <View
          style={{
            flexDirection: 'row',
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: tokens.style === 'google' ? 999 : tokens.eventRadius,
            overflow: 'hidden',
          }}
        >
          {VIEWS.map((item) => {
            const active = view === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => onViewChange(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  backgroundColor: active ? theme.primary : 'transparent',
                }}
              >
                <Text style={{ color: active ? theme.primaryText : theme.text, fontWeight: '600', fontSize: 13 }}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

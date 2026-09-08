import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { isWritableAccessRole } from '@/lib/events/create';
import { friendlyError } from '@/lib/errors';
import {
  defaultWeekdayRules,
  DURATION_PRESETS,
  listSchedulingLinks,
  saveSchedulingLink,
  WEEKDAY_LABELS,
  type AvailabilityRule,
  type SchedulingLink,
} from '@/lib/scheduling';
import { supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import type { CalendarConnection, ConnectedCalendar, ProviderName } from '@/lib/types';

type Cal = ConnectedCalendar & { provider: ProviderName; accountEmail: string | null };

export default function SchedulingLinkEditor() {
  const router = useRouter();
  const { theme, profile } = useSession();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = params.id && params.id !== 'new' ? String(params.id) : null;

  const [calendars, setCalendars] = useState<Cal[]>([]);
  const [title, setTitle] = useState('Reunião de 30 minutos');
  const [slug, setSlug] = useState('30min');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(30);
  const [customDuration, setCustomDuration] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [conflictIds, setConflictIds] = useState<string[]>([]);
  const [rules, setRules] = useState<AvailabilityRule[]>(defaultWeekdayRules());
  const [bufferBefore, setBufferBefore] = useState(0);
  const [bufferAfter, setBufferAfter] = useState(0);
  const [minimumNotice, setMinimumNotice] = useState(120);
  const [bookingWindow, setBookingWindow] = useState(30);
  const [customLocation, setCustomLocation] = useState('');
  const [useCustomLocation, setUseCustomLocation] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadCalendars = useCallback(async () => {
    const [{ data: cals }, { data: cons }] = await Promise.all([
      supabase.from('connected_calendars').select('*').eq('enabled', true),
      supabase.from('calendar_connections').select('*'),
    ]);
    const connections = (cons ?? []) as CalendarConnection[];
    const connById = new Map(connections.map((c) => [c.id, c]));
    const mapped = ((cals ?? []) as ConnectedCalendar[]).map((c) => {
      const conn = connById.get(c.connection_id);
      return {
        ...c,
        provider: (conn?.provider ?? 'GOOGLE') as ProviderName,
        accountEmail: conn?.account_email ?? null,
      };
    });
    setCalendars(mapped);
    if (!destinationId) {
      const writable = mapped.find((c) => isWritableAccessRole(c.access_role));
      if (writable) {
        setDestinationId(writable.id);
        setConflictIds(mapped.map((c) => c.id));
      }
    }
  }, [destinationId]);

  useEffect(() => {
    void loadCalendars();
  }, [loadCalendars]);

  useEffect(() => {
    if (!editingId) return;
    void (async () => {
      try {
        const data = await listSchedulingLinks();
        const link = data.links.find((l) => l.id === editingId);
        if (!link) return;
        applyLink(link);
      } catch (err) {
        Alert.alert('Both', friendlyError(err));
      }
    })();
  }, [editingId]);

  function applyLink(link: SchedulingLink) {
    setTitle(link.title);
    setSlug(link.slug);
    setDescription(link.description ?? '');
    setDuration(link.duration_minutes);
    setDestinationId(link.destination_calendar_id);
    setConflictIds(link.conflict_calendar_ids ?? []);
    setRules(link.availability_rules?.length ? link.availability_rules : defaultWeekdayRules());
    setBufferBefore(link.buffer_before_minutes);
    setBufferAfter(link.buffer_after_minutes);
    setMinimumNotice(link.minimum_notice_minutes);
    setBookingWindow(link.booking_window_days);
    setUseCustomLocation(link.conference_mode === 'custom');
    setCustomLocation(link.custom_location ?? '');
    setEnabled(link.enabled);
  }

  const writable = useMemo(
    () => calendars.filter((c) => isWritableAccessRole(c.access_role)),
    [calendars],
  );

  function toggleConflict(id: string) {
    setConflictIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleWeekday(weekday: number) {
    setRules((prev) => {
      const exists = prev.find((r) => r.weekday === weekday);
      if (exists) return prev.filter((r) => r.weekday !== weekday);
      return [...prev, { weekday, start: '09:00', end: '17:00' }].sort((a, b) => a.weekday - b.weekday);
    });
  }

  async function save() {
    const durationMinutes = customDuration ? Number(customDuration) : duration;
    if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
      Alert.alert('Both', 'Duração inválida (5–480 min).');
      return;
    }
    if (!destinationId || conflictIds.length === 0) {
      Alert.alert('Both', 'Escolha destino e calendários de conflito.');
      return;
    }
    setSaving(true);
    try {
      await saveSchedulingLink({
        action: editingId ? 'update' : 'create',
        id: editingId ?? undefined,
        slug,
        title,
        description: description || null,
        durationMinutes,
        destinationCalendarId: destinationId,
        conflictCalendarIds: conflictIds,
        timezone: profile?.timezone || 'UTC',
        availabilityRules: rules,
        bufferBeforeMinutes: bufferBefore,
        bufferAfterMinutes: bufferAfter,
        minimumNoticeMinutes: minimumNotice,
        bookingWindowDays: bookingWindow,
        conferenceMode: useCustomLocation ? 'custom' : 'none',
        customLocation: useCustomLocation ? customLocation : null,
        enabled,
      });
      showToast(editingId ? 'Link atualizado' : 'Link criado');
      router.replace('/(app)/scheduling' as Href);
    } catch (err) {
      Alert.alert('Both', friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen scroll>
      <Pressable onPress={() => router.back()}>
        <Typography variant="caption" style={{ color: theme.primary }}>
          ← Voltar
        </Typography>
      </Pressable>
      <Typography variant="pageTitle">{editingId ? 'Editar link' : 'Novo link'}</Typography>

      <Input label="Título" value={title} onChangeText={setTitle} />
      <Input label="Slug" value={slug} autoCapitalize="none" onChangeText={setSlug} helper="Ex.: 30min, cafe" />
      <Input label="Descrição" value={description} onChangeText={setDescription} multiline />

      <Typography variant="sectionTitle">Duração</Typography>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {DURATION_PRESETS.map((m) => (
          <Pressable
            key={m}
            onPress={() => {
              setDuration(m);
              setCustomDuration('');
            }}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: theme.radius,
              borderWidth: 1,
              borderColor: duration === m && !customDuration ? theme.primary : theme.border,
            }}
          >
            <Typography variant="caption">{m} min</Typography>
          </Pressable>
        ))}
      </View>
      <Input
        label="Customizada (min)"
        value={customDuration}
        onChangeText={setCustomDuration}
        keyboardType="number-pad"
        placeholder="ex. 20"
      />

      <Typography variant="sectionTitle">Disponibilidade</Typography>
      <View style={{ gap: space.sm }}>
        {WEEKDAY_LABELS.map((label, idx) => {
          const weekday = idx + 1;
          const rule = rules.find((r) => r.weekday === weekday);
          return (
            <View key={weekday} style={{ gap: 6 }}>
              <SwitchRow
                label={label}
                value={Boolean(rule)}
                onValueChange={() => toggleWeekday(weekday)}
              />
              {rule ? (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  <Input
                    label="Início"
                    value={rule.start}
                    onChangeText={(start) =>
                      setRules((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, start } : r)))
                    }
                  />
                  <Input
                    label="Fim"
                    value={rule.end}
                    onChangeText={(end) =>
                      setRules((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, end } : r)))
                    }
                  />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <Typography variant="sectionTitle">Buffers e janela</Typography>
      <Input
        label="Buffer antes (min)"
        value={String(bufferBefore)}
        keyboardType="number-pad"
        onChangeText={(v) => setBufferBefore(Number(v) || 0)}
      />
      <Input
        label="Buffer depois (min)"
        value={String(bufferAfter)}
        keyboardType="number-pad"
        onChangeText={(v) => setBufferAfter(Number(v) || 0)}
      />
      <Input
        label="Aviso mínimo (min)"
        value={String(minimumNotice)}
        keyboardType="number-pad"
        onChangeText={(v) => setMinimumNotice(Number(v) || 0)}
        helper="Ex.: 120 = não agendar com menos de 2 horas"
      />
      <Input
        label="Janela de agendamento (dias)"
        value={String(bookingWindow)}
        keyboardType="number-pad"
        onChangeText={(v) => setBookingWindow(Number(v) || 1)}
      />

      <Typography variant="sectionTitle">Verificar conflitos em</Typography>
      {calendars.map((c) => (
        <SwitchRow
          key={c.id}
          label={`${c.name} (${c.provider})`}
          value={conflictIds.includes(c.id)}
          onValueChange={() => toggleConflict(c.id)}
        />
      ))}

      <Typography variant="sectionTitle">Criar reuniões em</Typography>
      {writable.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => setDestinationId(c.id)}
          style={{
            padding: space.md,
            borderRadius: theme.radius,
            borderWidth: 1,
            borderColor: destinationId === c.id ? theme.primary : theme.border,
            marginBottom: space.sm,
          }}
        >
          <Typography variant="body">
            {c.name} · {c.provider}
          </Typography>
        </Pressable>
      ))}

      <SwitchRow
        label="Local personalizado"
        value={useCustomLocation}
        onValueChange={setUseCustomLocation}
      />
      {useCustomLocation ? (
        <Input label="Local" value={customLocation} onChangeText={setCustomLocation} />
      ) : (
        <Typography variant="caption" muted>
          Meet/Teams: use o comportamento nativo do provider via convite. Não geramos links falsos.
        </Typography>
      )}

      <SwitchRow label="Link ativo" value={enabled} onValueChange={setEnabled} />

      <Button label="Salvar" loading={saving} onPress={() => void save()} />
    </Screen>
  );
}

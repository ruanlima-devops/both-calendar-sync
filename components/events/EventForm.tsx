import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { localInputToUtc, localPartsFromUtc, todayKey } from '@/lib/dates';
import { isWritableAccessRole, toGoogleEventId, validateCreateEventForm } from '@/lib/events/create';
import { friendlyError } from '@/lib/errors';
import { invokeFunction, supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import type { CalendarConnection, CalendarEvent, ConnectedCalendar, ProviderName } from '@/lib/types';

const LAST_CAL_KEY = 'unify.lastCreateCalendarId';

type WritableCalendar = ConnectedCalendar & {
  provider: ProviderName;
  accountEmail: string | null;
};

export function EventForm({
  mode,
  eventId,
  initial,
}: {
  mode: 'create' | 'edit';
  eventId?: string;
  initial?: {
    date?: string;
    start?: string;
    end?: string;
    allDay?: boolean;
    calendarId?: string;
  };
}) {
  const { profile, theme } = useSession();
  const { showToast } = useToast();
  const router = useRouter();

  const tz = profile?.timezone ?? 'UTC';
  const [calendars, setCalendars] = useState<WritableCalendar[]>([]);
  const [calendarId, setCalendarId] = useState(initial?.calendarId ?? '');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initial?.date ?? todayKey(tz));
  const [start, setStart] = useState(initial?.start ?? '09:00');
  const [end, setEnd] = useState(initial?.end ?? '10:00');
  const [allDay, setAllDay] = useState(Boolean(initial?.allDay));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [block, setBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(mode === 'create');
  const [calendarLocked, setCalendarLocked] = useState(mode === 'edit');

  useEffect(() => {
    if (mode !== 'create') return;
    if (initial?.date && /^\d{4}-\d{2}-\d{2}$/.test(initial.date)) setDate(initial.date);
    if (initial?.start && /^\d{2}:\d{2}$/.test(initial.start)) setStart(initial.start);
    if (initial?.end && /^\d{2}:\d{2}$/.test(initial.end)) setEnd(initial.end);
    if (initial?.allDay) setAllDay(true);
    if (initial?.calendarId) setCalendarId(initial.calendarId);
  }, [mode, initial?.date, initial?.start, initial?.end, initial?.allDay, initial?.calendarId]);

  useEffect(() => {
    void (async () => {
      const [{ data: cals }, { data: cons }, lastId] = await Promise.all([
        supabase.from('connected_calendars').select('*').eq('enabled', true),
        supabase.from('calendar_connections').select('*'),
        AsyncStorage.getItem(LAST_CAL_KEY),
      ]);
      const connections = (cons ?? []) as CalendarConnection[];
      const connById = new Map(connections.map((c) => [c.id, c]));
      const writable = ((cals ?? []) as ConnectedCalendar[])
        .filter((c) => isWritableAccessRole(c.access_role))
        .map((c) => {
          const conn = connById.get(c.connection_id);
          return {
            ...c,
            provider: (conn?.provider ?? 'GOOGLE') as ProviderName,
            accountEmail: conn?.account_email ?? null,
          };
        });
      setCalendars(writable);

      if (mode === 'edit' && eventId) {
        const { data } = await supabase.from('calendar_events').select('*').eq('id', eventId).maybeSingle();
        const row = data as CalendarEvent | null;
        if (!row) {
          setError('Evento não encontrado.');
          setLoaded(true);
          return;
        }
        if (row.event_role === 'MIRROR') {
          setError('Este horário é gerenciado automaticamente. Edite o compromisso original.');
          setLoaded(true);
          return;
        }
        const partsStart = localPartsFromUtc(row.start_at, row.all_day ? 'UTC' : tz);
        const partsEnd = localPartsFromUtc(row.end_at, row.all_day ? 'UTC' : tz);
        setTitle(row.title ?? '');
        setDescription(row.description ?? '');
        setLocation(row.location ?? '');
        setAllDay(row.all_day);
        setDate(row.all_day ? row.start_at.slice(0, 10) : partsStart.date);
        setStart(partsStart.time);
        setEnd(row.all_day ? '23:59' : partsEnd.time);
        setCalendarId(row.connected_calendar_id);
        setCalendarLocked(true);

        if (row.sync_group_id) {
          const { data: mirrors } = await supabase
            .from('calendar_events')
            .select('id')
            .eq('sync_group_id', row.sync_group_id)
            .eq('event_role', 'MIRROR')
            .in('status', ['confirmed', 'tentative']);
          setBlock((mirrors?.length ?? 0) > 0);
        } else {
          setBlock(false);
        }
        setLoaded(true);
        return;
      }

      const preferred =
        (initial?.calendarId && writable.find((c) => c.id === initial.calendarId)?.id) ||
        (lastId && writable.find((c) => c.id === lastId)?.id) ||
        writable.find((c) => c.is_primary)?.id ||
        writable[0]?.id ||
        '';
      setCalendarId((current) => current || preferred);
      setLoaded(true);
    })();
  }, [mode, eventId, initial?.calendarId, tz]);

  const groups = useMemo(() => {
    const map = new Map<string, { provider: ProviderName; email: string | null; items: WritableCalendar[] }>();
    for (const cal of calendars) {
      const key = `${cal.provider}:${cal.connection_id}`;
      const existing = map.get(key);
      if (existing) existing.items.push(cal);
      else map.set(key, { provider: cal.provider, email: cal.accountEmail, items: [cal] });
    }
    return [...map.values()];
  }, [calendars]);

  const selected = calendars.find((c) => c.id === calendarId);
  const providerLabel = selected?.provider === 'MICROSOFT' ? 'Microsoft Calendar' : 'Google Calendar';
  const otherWritable = calendars.filter((c) => c.id !== calendarId);

  async function save() {
    if (busy) return;
    const validation = validateCreateEventForm({ title, date, start, end, allDay, calendarId });
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const endDateExclusive = (() => {
        const next = new Date(`${date}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        return next.toISOString().slice(0, 10);
      })();

      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startAt: allDay ? `${date}T00:00:00.000Z` : localInputToUtc(date, start, tz),
        endAt: allDay ? `${endDateExclusive}T00:00:00.000Z` : localInputToUtc(date, end, tz),
        timezone: tz,
        allDay,
        blockOtherCalendars: block,
      };

      if (mode === 'edit' && eventId) {
        const result = await invokeFunction<{
          createdMirrors?: number;
          deletedMirrors?: number;
          errors?: string[];
        }>('update-event', { eventId, ...payload });

        showToast(
          result.createdMirrors && result.createdMirrors > 0
            ? 'Horário reservado nas outras agendas'
            : 'Evento atualizado',
        );
        if (result.errors?.length) {
          Alert.alert('Atualizado com aviso', result.errors.join('\n'));
        }
        router.back();
        return;
      }

      const uuid = Crypto.randomUUID();
      const clientEventId = toGoogleEventId(uuid);
      const result = await invokeFunction<{
        partial?: boolean;
        errors?: string[];
        event?: { id: string };
      }>('create-event', {
        connectedCalendarId: calendarId,
        ...payload,
        clientEventId,
        clientRequestId: clientEventId,
      });

      await AsyncStorage.setItem(LAST_CAL_KEY, calendarId);
      if (result.partial) {
        Alert.alert(
          'Criado com aviso',
          result.errors?.join('\n') ?? 'Não foi possível bloquear todas as agendas.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else {
        showToast(block && otherWritable.length > 0 ? 'Horário reservado nas outras agendas' : 'Evento criado');
        router.back();
      }
    } catch (err) {
      const message = friendlyError(
        err,
        mode === 'edit'
          ? `Não foi possível atualizar o evento no ${providerLabel}. Tente novamente.`
          : `Não foi possível criar o evento no ${providerLabel}. Tente novamente.`,
      );
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <Screen>
        <Typography variant="body" muted>
          Carregando…
        </Typography>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ gap: space.xs }}>
        <Typography variant="pageTitle">{mode === 'edit' ? 'Editar evento' : 'Novo evento'}</Typography>
        <Typography variant="body" muted>
          {mode === 'edit'
            ? 'As alterações são aplicadas diretamente na agenda de origem.'
            : 'O evento será criado diretamente na agenda escolhida.'}
        </Typography>
      </View>

      <Input label="Título" value={title} onChangeText={setTitle} placeholder="Reunião, compromisso…" autoFocus />
      <Input label="Data" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />

      <SwitchRow label="Dia inteiro" value={allDay} onValueChange={setAllDay} />

      {allDay ? null : (
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Input label="Início" value={start} onChangeText={setStart} placeholder="HH:mm" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Fim" value={end} onChangeText={setEnd} placeholder="HH:mm" />
          </View>
        </View>
      )}

      <Input label="Local" value={location} onChangeText={setLocation} placeholder="Opcional" />
      <Input
        label="Descrição"
        value={description}
        onChangeText={setDescription}
        placeholder="Opcional"
        multiline
        style={{ minHeight: 80, textAlignVertical: 'top' }}
      />

      <View style={{ gap: space.sm }}>
        <Typography variant="sectionTitle">Calendário</Typography>
        {calendarLocked ? (
          <Typography variant="metadata" muted>
            A troca de calendário entre providers não é suportada nesta versão. O evento permanece em{' '}
            {selected?.name ?? 'sua agenda atual'}.
          </Typography>
        ) : (
          <Typography variant="metadata" muted>
            Somente agendas com permissão de escrita
          </Typography>
        )}
        {groups.length === 0 ? (
          <Typography variant="body" muted>
            Nenhuma agenda editável conectada. Conecte Google ou Microsoft com permissão de escrita.
          </Typography>
        ) : null}
        {groups.map((group) => (
          <View key={`${group.provider}-${group.email}`} style={{ gap: space.xs }}>
            <Typography variant="caption" muted>
              {group.provider === 'GOOGLE' ? 'Google' : 'Microsoft'}
              {group.email ? ` · ${group.email}` : ''}
            </Typography>
            {group.items.map((cal) => {
              const selectedCal = calendarId === cal.id;
              return (
                <Pressable
                  key={cal.id}
                  onPress={() => {
                    if (calendarLocked) return;
                    setCalendarId(cal.id);
                  }}
                  disabled={calendarLocked}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedCal }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 12,
                    borderRadius: theme.radius,
                    borderWidth: 1,
                    borderColor: selectedCal ? cal.color : theme.border,
                    backgroundColor: theme.surface,
                    opacity: calendarLocked && !selectedCal ? 0.45 : 1,
                  }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      borderWidth: 2,
                      borderColor: cal.color,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {selectedCal ? (
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cal.color }} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Typography variant="body">{cal.name}</Typography>
                    {cal.is_primary ? (
                      <Typography variant="metadata" muted>
                        Principal
                      </Typography>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View
        style={{
          gap: space.sm,
          padding: 14,
          borderRadius: theme.radius,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
        }}
      >
        <Typography variant="sectionTitle">Disponibilidade</Typography>
        <SwitchRow
          label="Reservar este horário nas minhas outras agendas"
          description="Usa as regras de Disponibilidade (Calendar Firewall). Sem regras, reserva em todas as agendas graváveis com privacidade total."
          value={block}
          onValueChange={setBlock}
          disabled={otherWritable.length === 0}
        />
        {block && otherWritable.length > 0 ? (
          <View style={{ gap: space.xs, paddingTop: space.xs }}>
            <Typography variant="caption" muted>
              Bloquear em
            </Typography>
            {otherWritable.map((cal) => (
              <Typography key={cal.id} variant="body">
                ✓ {cal.provider === 'GOOGLE' ? 'Google' : 'Microsoft'} · {cal.name}
              </Typography>
            ))}
          </View>
        ) : null}
        {otherWritable.length === 0 ? (
          <Typography variant="metadata" muted>
            Conecte outra agenda editável para reservar o horário automaticamente.
          </Typography>
        ) : null}
      </View>

      {error ? (
        <Typography variant="caption" style={{ color: theme.danger }}>
          {error}
        </Typography>
      ) : null}

      <Button
        label={busy ? (mode === 'edit' ? 'Salvando…' : 'Criando…') : 'Salvar'}
        onPress={() => void save()}
        loading={busy}
        disabled={busy || !calendarId || Boolean(error?.includes('gerenciado'))}
      />
      <Button label="Cancelar" variant="ghost" onPress={() => router.back()} disabled={busy} />
    </Screen>
  );
}

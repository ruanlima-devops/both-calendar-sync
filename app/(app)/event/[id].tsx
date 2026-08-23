import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { formatEventDetail } from '@/lib/dates';
import { busyBlockDisplayTitle, isBusyBlockEvent } from '@/lib/events';
import { isWritableAccessRole } from '@/lib/events/create';
import { friendlyError } from '@/lib/errors';
import { invokeFunction, supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import type { CalendarConnection, CalendarEvent, ConnectedCalendar, ProviderName } from '@/lib/types';

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, theme } = useSession();
  const { showToast } = useToast();
  const router = useRouter();

  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [calendar, setCalendar] = useState<ConnectedCalendar | null>(null);
  const [provider, setProvider] = useState<ProviderName | null>(null);
  const [originId, setOriginId] = useState<string | null>(null);
  const [mirrorCount, setMirrorCount] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('calendar_events').select('*').eq('id', id).maybeSingle();
      if (!data) return;
      const row = data as CalendarEvent;
      setEvent(row);

      const { data: cal } = await supabase
        .from('connected_calendars')
        .select('*')
        .eq('id', row.connected_calendar_id)
        .maybeSingle();
      const calendarRow = cal as ConnectedCalendar | null;
      setCalendar(calendarRow);

      if (calendarRow) {
        const { data: conn } = await supabase
          .from('calendar_connections')
          .select('*')
          .eq('id', calendarRow.connection_id)
          .maybeSingle();
        setProvider(((conn as CalendarConnection | null)?.provider ?? null) as ProviderName | null);
      }

      if (row.sync_group_id) {
        const { data: group } = await supabase
          .from('calendar_events')
          .select('*')
          .eq('sync_group_id', row.sync_group_id)
          .in('status', ['confirmed', 'tentative']);
        const rows = (group ?? []) as CalendarEvent[];
        setMirrorCount(rows.filter((e) => e.event_role === 'MIRROR').length);
        const origin = rows.find((e) => e.event_role === 'ORIGIN' || e.event_role === 'EXTERNAL');
        if (origin && origin.id !== row.id) setOriginId(origin.id);
      }
    })();
  }, [id]);

  if (!event) {
    return (
      <Screen>
        <Typography variant="body" muted>
          Carregando…
        </Typography>
      </Screen>
    );
  }

  const tz = profile?.timezone ?? event.timezone;
  const { dateLine, timeLine } = formatEventDetail(event.start_at, event.end_at, tz, event.all_day);
  const isMirror = isBusyBlockEvent(event);
  const writable = isWritableAccessRole(calendar?.access_role);
  const providerLabel = provider === 'MICROSOFT' ? 'Microsoft Calendar' : 'Google Calendar';
  const title = isMirror ? busyBlockDisplayTitle(event.title) : event.title || '(sem título)';

  async function remove() {
    if (deleting || !event) return;
    setDeleting(true);
    setError(null);
    try {
      await invokeFunction('delete-event', { eventId: event.id });
      showToast('Evento excluído');
      router.back();
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível excluir o evento. Tente novamente.'));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Screen scroll>
      <View style={{ gap: space.xs }}>
        <Typography variant="pageTitle">{title}</Typography>
        <Typography variant="body" muted style={{ textTransform: 'capitalize' }}>
          {dateLine}
        </Typography>
        {timeLine ? <Typography variant="sectionTitle">{timeLine}</Typography> : null}
      </View>

      <View style={{ gap: space.xs }}>
        <Typography variant="caption" muted>
          {providerLabel}
        </Typography>
        <Typography variant="body">{calendar?.name ?? 'Agenda'}</Typography>
      </View>

      {isMirror ? (
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
          <Typography variant="body">
            Este período foi bloqueado automaticamente pelo Unify para evitar conflitos entre suas agendas.
          </Typography>
          <Typography variant="metadata" muted>
            Os detalhes do compromisso original permanecem privados.
          </Typography>
          {originId ? (
            <Button
              label="Ver compromisso original"
              variant="secondary"
              onPress={() => router.replace(`/(app)/event/${originId}`)}
            />
          ) : null}
          <Typography variant="metadata" muted>
            Edite o compromisso original para alterar ou remover esta reserva.
          </Typography>
        </View>
      ) : (
        <>
          {event.location ? (
            <View style={{ gap: 4 }}>
              <Typography variant="caption" muted>
                Local
              </Typography>
              <Typography variant="body">{event.location}</Typography>
            </View>
          ) : null}
          {event.description ? (
            <View style={{ gap: 4 }}>
              <Typography variant="caption" muted>
                Descrição
              </Typography>
              <Typography variant="body">{event.description}</Typography>
            </View>
          ) : null}
          {mirrorCount > 0 ? (
            <Typography variant="metadata" muted>
              Horário reservado em {mirrorCount} outra{mirrorCount === 1 ? '' : 's'} agenda
              {mirrorCount === 1 ? '' : 's'}
            </Typography>
          ) : null}
        </>
      )}

      {!writable && !isMirror ? (
        <Typography variant="metadata" muted>
          Esta agenda é somente leitura — editar e excluir não estão disponíveis.
        </Typography>
      ) : null}

      {error ? (
        <Typography variant="caption" style={{ color: theme.danger }}>
          {error}
        </Typography>
      ) : null}

      {confirmDelete ? (
        <View
          style={{
            gap: space.sm,
            padding: 16,
            borderRadius: theme.radius,
            borderWidth: 1,
            borderColor: theme.danger,
            backgroundColor: theme.surface,
          }}
        >
          <Typography variant="sectionTitle">Excluir evento?</Typography>
          <Typography variant="body" muted>
            “{title}” será removido do {providerLabel}.
            {mirrorCount > 0
              ? ' As reservas criadas pelo Unify nas outras agendas também serão removidas.'
              : ''}{' '}
            Esta ação não pode ser desfeita.
          </Typography>
          <Button
            label={deleting ? 'Excluindo…' : 'Excluir evento'}
            variant="danger"
            loading={deleting}
            disabled={deleting}
            onPress={() => void remove()}
          />
          <Button
            label="Cancelar"
            variant="ghost"
            disabled={deleting}
            onPress={() => setConfirmDelete(false)}
          />
        </View>
      ) : (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          {!isMirror && writable ? (
            <>
              <Button
                label="Editar"
                onPress={() =>
                  router.push({ pathname: '/(app)/event/new', params: { editId: event.id } })
                }
              />
              <Button label="Excluir" variant="danger" onPress={() => setConfirmDelete(true)} />
            </>
          ) : null}
          <Button label="Fechar" variant="ghost" onPress={() => router.back()} />
        </View>
      )}
    </Screen>
  );
}

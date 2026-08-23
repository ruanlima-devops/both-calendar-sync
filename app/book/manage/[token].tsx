import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { UnifyLogo } from '@/components/brand/UnifyLogo';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import {
  cancelManagedBooking,
  detectBrowserTimezone,
  fetchManageBooking,
  formatSlotRange,
  formatSlotTime,
  groupSlotsByDay,
  rescheduleManagedBooking,
  type PublicSlot,
} from '@/lib/scheduling';
import { schemeTokens, space } from '@/lib/theme';

export default function ManageBookingPage() {
  const { theme } = useSession();
  const brand = schemeTokens(theme.scheme);
  const params = useLocalSearchParams<{ token: string }>();
  const token = String(params.token ?? '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'done'>('view');
  const [message, setMessage] = useState('');
  const [guestTz] = useState(detectBrowserTimezone());
  const [booking, setBooking] = useState<{
    title: string;
    status: string;
    startAt: string;
    endAt: string;
    timezone: string;
  } | null>(null);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchManageBooking(token);
      setBooking({
        title: data.booking.title,
        status: data.booking.status,
        startAt: data.booking.startAt,
        endAt: data.booking.endAt,
        timezone: data.booking.timezone,
      });
      setSlots(data.slots);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link inválido');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => groupSlotsByDay(slots, guestTz), [slots, guestTz]);

  async function onCancel() {
    setBusy(true);
    try {
      await cancelManagedBooking(token);
      setMessage('Agendamento cancelado.');
      setMode('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao cancelar');
    } finally {
      setBusy(false);
    }
  }

  async function onReschedule(slot: PublicSlot) {
    setBusy(true);
    setError(null);
    try {
      await rescheduleManagedBooking(token, slot.startAt);
      setMessage(`Reagendado para ${formatSlotRange(slot.startAt, slot.endAt, guestTz)}`);
      setMode('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao reagendar');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <UnifyLogo colors={brand} size="sm" />
      <Typography variant="pageTitle">Gerenciar agendamento</Typography>
      {error ? (
        <Typography variant="body" style={{ color: theme.danger }}>
          {error}
        </Typography>
      ) : null}
      {mode === 'done' ? (
        <Typography variant="sectionTitle">{message}</Typography>
      ) : booking ? (
        <>
          <Typography variant="sectionTitle">{booking.title}</Typography>
          <Typography variant="body">
            {formatSlotRange(booking.startAt, booking.endAt, guestTz)}
          </Typography>
          <Typography variant="caption" muted>
            Status: {booking.status}
          </Typography>
          {mode === 'view' ? (
            <View style={{ gap: space.sm }}>
              <Button label="Reagendar" variant="secondary" onPress={() => setMode('reschedule')} />
              <Button label="Cancelar agendamento" variant="danger" loading={busy} onPress={() => void onCancel()} />
            </View>
          ) : (
            <View style={{ gap: space.md }}>
              <Typography variant="body">Escolha um novo horário</Typography>
              {days.map((day) => (
                <View key={day.dayKey} style={{ gap: space.sm }}>
                  <Typography variant="caption">{day.label}</Typography>
                  {day.slots.map((slot) => (
                    <Pressable
                      key={slot.startAt}
                      disabled={busy}
                      onPress={() => void onReschedule(slot)}
                      style={{
                        padding: space.md,
                        borderRadius: theme.radius,
                        borderWidth: 1,
                        borderColor: theme.border,
                        backgroundColor: theme.surface,
                      }}
                    >
                      <Typography variant="body">{formatSlotTime(slot.startAt, guestTz)}</Typography>
                    </Pressable>
                  ))}
                </View>
              ))}
              <Button label="Voltar" variant="ghost" onPress={() => setMode('view')} />
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

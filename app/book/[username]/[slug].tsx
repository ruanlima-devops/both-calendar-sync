import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { BothLogo } from '@/components/brand/BothLogo';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { listTimezones } from '@/lib/timezones';
import {
  detectBrowserTimezone,
  fetchPublicBooking,
  formatSlotRange,
  formatSlotTime,
  groupSlotsByDay,
  submitPublicBooking,
  type PublicSlot,
} from '@/lib/scheduling';
import { schemeTokens, space } from '@/lib/theme';

type Step = 'slots' | 'details' | 'done';

export default function PublicBookingPage() {
  const { theme } = useSession();
  const brand = schemeTokens(theme.scheme);
  const params = useLocalSearchParams<{ username: string; slug: string }>();
  const username = String(params.username ?? '').toLowerCase();
  const slug = String(params.slug ?? '').toLowerCase();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostName, setHostName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [duration, setDuration] = useState(30);
  const [hostTz, setHostTz] = useState('UTC');
  const [guestTz, setGuestTz] = useState(detectBrowserTimezone());
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [step, setStep] = useState<Step>('slots');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestNotes, setGuestNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    hostName: string;
    startAt: string;
    endAt: string;
    guestEmail: string;
    timezone: string;
    manageToken: string;
  } | null>(null);
  const [showTz, setShowTz] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPublicBooking(username, slug);
      setHostName(page.host.displayName);
      setTitle(page.link.title);
      setDescription(page.link.description);
      setDuration(page.link.durationMinutes);
      setHostTz(page.link.timezone);
      setSlots(page.slots);
      const grouped = groupSlotsByDay(page.slots, guestTz);
      if (grouped[0]) setSelectedDay(grouped[0].dayKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link indisponível');
    } finally {
      setLoading(false);
    }
  }, [username, slug, guestTz]);

  useEffect(() => {
    void load();
  }, [username, slug]);

  const days = useMemo(() => groupSlotsByDay(slots, guestTz), [slots, guestTz]);
  const daySlots = useMemo(
    () => days.find((d) => d.dayKey === selectedDay)?.slots ?? [],
    [days, selectedDay],
  );
  const timezones = useMemo(() => listTimezones().slice(0, 80), []);

  async function confirm() {
    if (!selectedSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitPublicBooking({
        username,
        slug,
        startAt: selectedSlot.startAt,
        guestName,
        guestEmail,
        guestNotes: guestNotes || undefined,
        guestTimezone: guestTz,
      });
      setConfirmation(result);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao agendar');
      if (String(err).includes('indisponível')) {
        setStep('slots');
        setSelectedSlot(null);
        await load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  if (step === 'done' && confirmation) {
    return (
      <Screen scroll>
        <BothLogo colors={brand} size="sm" />
        <Typography variant="pageTitle">Agendamento confirmado</Typography>
        <Typography variant="body">
          Reunião com {confirmation.hostName}
        </Typography>
        <Typography variant="sectionTitle">
          {formatSlotRange(confirmation.startAt, confirmation.endAt, guestTz)}
        </Typography>
        <Typography variant="body" muted>
          Um convite foi enviado para: {confirmation.guestEmail}
        </Typography>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BothLogo colors={brand} size="sm" />
      <Typography variant="pageTitle">{hostName}</Typography>
      <Typography variant="sectionTitle">{title}</Typography>
      <Typography variant="caption" muted>
        {duration} min · Horários em {guestTz}
      </Typography>
      {description ? (
        <Typography variant="body" muted>
          {description}
        </Typography>
      ) : null}

      <Pressable onPress={() => setShowTz((v) => !v)}>
        <Typography variant="caption" style={{ color: theme.primary }}>
          Trocar fuso horário
        </Typography>
      </Pressable>
      {showTz ? (
        <View style={{ gap: 6, maxHeight: 180 }}>
          {timezones.map((tz) => (
            <Pressable
              key={tz}
              onPress={() => {
                setGuestTz(tz);
                setShowTz(false);
              }}
            >
              <Typography variant="caption">{tz}</Typography>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? (
        <Typography variant="body" style={{ color: theme.danger }}>
          {error}
        </Typography>
      ) : null}

      {step === 'slots' ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {days.map((day) => (
              <Pressable
                key={day.dayKey}
                onPress={() => {
                  setSelectedDay(day.dayKey);
                  setSelectedSlot(null);
                }}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: theme.radius,
                  borderWidth: 1,
                  borderColor: selectedDay === day.dayKey ? theme.primary : theme.border,
                  backgroundColor: selectedDay === day.dayKey ? theme.surfaceMuted : theme.surface,
                }}
              >
                <Typography variant="caption">{day.label}</Typography>
              </Pressable>
            ))}
          </View>

          <View style={{ gap: space.sm }}>
            {daySlots.map((slot) => (
              <Pressable
                key={slot.startAt}
                onPress={() => {
                  setSelectedSlot(slot);
                  setStep('details');
                }}
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
            {days.length === 0 ? (
              <Typography variant="body" muted>
                Nenhum horário disponível neste período.
              </Typography>
            ) : null}
          </View>
        </>
      ) : (
        <View style={{ gap: space.md }}>
          <Typography variant="sectionTitle">
            {selectedSlot ? formatSlotRange(selectedSlot.startAt, selectedSlot.endAt, guestTz) : ''}
          </Typography>
          <Typography variant="caption" muted>
            Fuso do anfitrião: {hostTz}
          </Typography>
          <TextInput
            placeholder="Seu nome"
            placeholderTextColor={theme.muted}
            value={guestName}
            onChangeText={setGuestName}
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: theme.radius,
              padding: space.md,
              color: theme.text,
              backgroundColor: theme.surface,
            }}
          />
          <TextInput
            placeholder="Seu email"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={guestEmail}
            onChangeText={setGuestEmail}
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: theme.radius,
              padding: space.md,
              color: theme.text,
              backgroundColor: theme.surface,
            }}
          />
          <TextInput
            placeholder="Observação (opcional)"
            placeholderTextColor={theme.muted}
            value={guestNotes}
            onChangeText={setGuestNotes}
            multiline
            style={{
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: theme.radius,
              padding: space.md,
              color: theme.text,
              backgroundColor: theme.surface,
              minHeight: 80,
            }}
          />
          <Button
            label="Confirmar agendamento"
            loading={submitting}
            disabled={!guestName.trim() || !guestEmail.trim()}
            onPress={() => void confirm()}
          />
          <Button
            label="Voltar"
            variant="ghost"
            onPress={() => {
              setStep('slots');
              setSelectedSlot(null);
            }}
          />
        </View>
      )}
    </Screen>
  );
}

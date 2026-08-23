import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Share, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { friendlyError } from '@/lib/errors';
import {
  bookingPageUrl,
  listSchedulingLinks,
  saveSchedulingLink,
  setBookingUsername,
  type SchedulingLink,
} from '@/lib/scheduling';
import { space } from '@/lib/theme';

export default function SchedulingDashboard() {
  const router = useRouter();
  const { theme } = useSession();
  const { showToast } = useToast();
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [links, setLinks] = useState<SchedulingLink[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listSchedulingLinks();
      setSavedUsername(data.bookingUsername);
      setUsername(data.bookingUsername ?? '');
      setLinks(data.links);
    } catch (err) {
      Alert.alert('Unify', friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveUsername() {
    try {
      const res = await setBookingUsername(username.trim().toLowerCase());
      setSavedUsername(res.bookingUsername);
      showToast('Username salvo');
      await load();
    } catch (err) {
      Alert.alert('Unify', friendlyError(err));
    }
  }

  async function copyLink(link: SchedulingLink) {
    if (!savedUsername) {
      Alert.alert('Unify', 'Defina um username de agendamento primeiro.');
      return;
    }
    const url = bookingPageUrl(savedUsername, link.slug);
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      showToast('Link copiado');
      return;
    }
    await Share.share({ message: url, url });
    showToast('Link pronto para compartilhar');
  }

  async function toggleEnabled(link: SchedulingLink) {
    try {
      await saveSchedulingLink({
        action: 'update',
        id: link.id,
        slug: link.slug,
        title: link.title,
        description: link.description,
        durationMinutes: link.duration_minutes,
        destinationCalendarId: link.destination_calendar_id,
        conflictCalendarIds: link.conflict_calendar_ids ?? [],
        timezone: link.timezone,
        availabilityRules: link.availability_rules,
        bufferBeforeMinutes: link.buffer_before_minutes,
        bufferAfterMinutes: link.buffer_after_minutes,
        minimumNoticeMinutes: link.minimum_notice_minutes,
        bookingWindowDays: link.booking_window_days,
        conferenceMode: link.conference_mode,
        customLocation: link.custom_location,
        enabled: !link.enabled,
        expiresAt: link.expires_at,
      });
      await load();
      showToast(link.enabled ? 'Link desativado' : 'Link ativado');
    } catch (err) {
      Alert.alert('Unify', friendlyError(err));
    }
  }

  return (
    <Screen scroll>
      <Pressable onPress={() => router.back()}>
        <Typography variant="caption" style={{ color: theme.primary }}>
          ← Conta
        </Typography>
      </Pressable>
      <Typography variant="pageTitle">Agendamento</Typography>
      <Typography variant="body" muted>
        Compartilhe sua disponibilidade real com um link público.
      </Typography>

      <Card>
        <Typography variant="sectionTitle">Username público</Typography>
        <Input
          label="unify.app/seu-username/…"
          value={username}
          autoCapitalize="none"
          onChangeText={setUsername}
          placeholder="ruan"
        />
        <Button label="Salvar username" variant="secondary" onPress={() => void saveUsername()} />
      </Card>

      <Button label="Novo link de agendamento" onPress={() => router.push('/(app)/scheduling/new' as Href)} />

      {loading ? (
        <Typography variant="body" muted>
          Carregando…
        </Typography>
      ) : links.length === 0 ? (
        <Typography variant="body" muted>
          Nenhum link ainda.
        </Typography>
      ) : (
        links.map((link) => (
          <Card key={link.id}>
            <Typography variant="sectionTitle">{link.title}</Typography>
            <Typography variant="caption" muted>
              {savedUsername
                ? bookingPageUrl(savedUsername, link.slug).replace(/^https?:\/\//, '')
                : `…/${link.slug}`}
            </Typography>
            <Typography variant="caption" muted>
              {link.enabled ? 'Ativo' : 'Inativo'} · {link.duration_minutes} min
            </Typography>
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Button label="Copiar link" variant="secondary" onPress={() => void copyLink(link)} />
              <Button
                label="Editar"
                variant="ghost"
                onPress={() => router.push(`/(app)/scheduling/${link.id}` as Href)}
              />
              <Button
                label={link.enabled ? 'Desativar' : 'Ativar'}
                variant="ghost"
                onPress={() => void toggleEnabled(link)}
              />
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SessionSplash } from '@/components/auth/SessionSplash';
import { useSession } from '@/context/session';
import { connectCalendar } from '@/lib/oauth';
import { supabase } from '@/lib/supabase';
import { googleTheme, microsoftTheme } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import type { ConnectedCalendar } from '@/lib/types';

export default function Onboarding() {
  const { profile, refreshProfile, theme } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [calendars, setCalendars] = useState<ConnectedCalendar[]>([]);
  if (!profile) return <SessionSplash />;

  async function saveTheme(visual_theme: 'GOOGLE_STYLE' | 'MICROSOFT_STYLE') {
    await supabase.from('profiles').update({ visual_theme, display_name: name || profile?.display_name }).eq('id', profile!.id);
    await refreshProfile();
    setStep(1);
  }

  async function connect(provider: 'google' | 'microsoft') {
    try {
      await connectCalendar(provider);
      const { data: rows } = await supabase.from('connected_calendars').select('*');
      setCalendars((rows ?? []) as ConnectedCalendar[]);
    } catch {
      Alert.alert('Both', 'Não foi possível conectar o calendário. Tente novamente.');
    }
  }

  async function finish() {
    await supabase.from('profiles').update({ onboarding_completed_at: new Date().toISOString(), display_name: name }).eq('id', profile!.id);
    await refreshProfile();
    router.replace('/');
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 24, gap: 16, paddingTop: 72 }}>
      {step === 0 ? (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: theme.text }}>Bem-vindo</Text>
          <Text style={{ color: theme.muted }}>Como você prefere trabalhar?</Text>
          <TextInput
            placeholder="Seu nome"
            value={name}
            onChangeText={setName}
            style={{ backgroundColor: theme.surface, borderRadius: theme.radius, padding: 14, borderWidth: 1, borderColor: theme.border }}
          />
          <Pressable onPress={() => void saveTheme('GOOGLE_STYLE')} style={{ padding: 18, borderRadius: googleTheme.radius, backgroundColor: googleTheme.surface, borderWidth: 1, borderColor: googleTheme.border }}>
            <Text style={{ fontWeight: '700' }}>Estilo Google</Text>
            <Text style={{ color: googleTheme.muted }}>Leve, claro, cartões arredondados.</Text>
          </Pressable>
          <Pressable onPress={() => void saveTheme('MICROSOFT_STYLE')} style={{ padding: 18, borderRadius: microsoftTheme.radius, backgroundColor: microsoftTheme.surface, borderWidth: 1, borderColor: microsoftTheme.border }}>
            <Text style={{ fontWeight: '700' }}>Estilo Microsoft</Text>
            <Text style={{ color: microsoftTheme.muted }}>Denso, corporativo, focado em produtividade.</Text>
          </Pressable>
        </>
      ) : step === 1 ? (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: theme.text }}>Conecte suas agendas</Text>
          <Button label="Conectar Google" onPress={() => void connect('google')} />
          <Button label="Conectar Microsoft / Teams" onPress={() => void connect('microsoft')} variant="ghost" />
          <Button label="Continuar" onPress={() => setStep(2)} variant="ghost" />
        </>
      ) : (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: theme.text }}>Calendários</Text>
          <Text style={{ color: theme.muted }}>Escolha quais aparecerão e se novos eventos externos devem bloquear as outras agendas.</Text>
          {calendars.map((cal) => (
            <Pressable
              key={cal.id}
              onPress={() => {
                const enabled = !cal.enabled;
                void supabase.from('connected_calendars').update({ enabled }).eq('id', cal.id);
                setCalendars((rows) => rows.map((r) => (r.id === cal.id ? { ...r, enabled } : r)));
              }}
              style={{ padding: 14, borderRadius: theme.radius, backgroundColor: theme.surface, borderWidth: 1, borderColor: cal.enabled ? cal.color : theme.border }}
            >
              <Text style={{ fontWeight: '600', color: theme.text }}>{cal.name}</Text>
              <Text style={{ color: theme.muted }}>{cal.enabled ? 'Visível' : 'Oculto'}</Text>
              <Pressable
                onPress={() => {
                  const auto_block_others = !cal.auto_block_others;
                  void supabase.from('connected_calendars').update({ auto_block_others }).eq('id', cal.id);
                  setCalendars((rows) => rows.map((r) => (r.id === cal.id ? { ...r, auto_block_others } : r)));
                }}
              >
                <Text style={{ color: theme.primary, marginTop: 8 }}>
                  {cal.auto_block_others ? 'Auto-bloquear outras: ligado' : 'Auto-bloquear outras: desligado'}
                </Text>
              </Pressable>
            </Pressable>
          ))}
          <Button label="Abrir agenda unificada" onPress={() => void finish()} />
        </>
      )}
    </ScrollView>
  );
}

import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SessionSplash } from '@/components/auth/SessionSplash';
import { useSession } from '@/context/session';
import { showMessage } from '@/lib/confirm';
import { connectCalendar } from '@/lib/oauth';
import {
  enabledCalendarCount,
  toggleAutoBlockOthers,
  toggleCalendarEnabled,
} from '@/lib/onboarding/calendar-step';
import {
  canFinishOnboarding,
  classifyProviderConnectError,
  firstSyncCopy,
} from '@/lib/onboarding/journey';
import { supabase } from '@/lib/supabase';
import { googleTheme, microsoftTheme } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import type { ConnectedCalendar } from '@/lib/types';

const STEPS = ['Preferências', 'Conectar', 'Calendários', 'Pronto'] as const;

export default function Onboarding() {
  const { profile, refreshProfile, theme } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [calendars, setCalendars] = useState<ConnectedCalendar[]>([]);
  const [connecting, setConnecting] = useState<'google' | 'microsoft' | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  if (!profile) return <SessionSplash />;

  async function saveTheme(visual_theme: 'GOOGLE_STYLE' | 'MICROSOFT_STYLE') {
    await supabase
      .from('profiles')
      .update({ visual_theme, display_name: name || profile?.display_name })
      .eq('id', profile!.id);
    await refreshProfile();
    setStep(1);
  }

  async function connect(provider: 'google' | 'microsoft') {
    if (connecting) return;
    setConnecting(provider);
    setConnectError(null);
    try {
      await connectCalendar(provider);
      const { data: rows } = await supabase.from('connected_calendars').select('*');
      setCalendars((rows ?? []) as ConnectedCalendar[]);
      setStep(2);
    } catch (error) {
      const classified = classifyProviderConnectError(error);
      setConnectError(classified.ok ? null : classified.message);
    } finally {
      setConnecting(null);
    }
  }

  async function finish() {
    if (finishing) return;
    const gate = canFinishOnboarding({
      calendarCount: calendars.length,
      enabledCount: enabledCalendarCount(calendars),
    });
    if (!gate.ok) {
      showMessage('Both', gate.message);
      if (gate.code === 'NO_CALENDARS') setStep(1);
      return;
    }
    setFinishing(true);
    try {
      await supabase
        .from('profiles')
        .update({ onboarding_completed_at: new Date().toISOString(), display_name: name })
        .eq('id', profile!.id);
      await refreshProfile();
      setStep(3);
    } finally {
      setFinishing(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 24, gap: 16, paddingTop: 72 }}
      accessibilityLabel={`Onboarding, etapa ${step + 1} de ${STEPS.length}: ${STEPS[step]}`}
    >
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }} accessibilityRole="summary">
        {STEPS.map((label, index) => (
          <View key={label} style={{ flex: 1, gap: 4 }}>
            <View
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: index <= step ? theme.primary : theme.border,
              }}
            />
            <Text style={{ fontSize: 11, color: index === step ? theme.text : theme.muted }} numberOfLines={1}>
              {label}
            </Text>
          </View>
        ))}
      </View>

      {step === 0 ? (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: theme.text }} accessibilityRole="header">
            Bem-vindo
          </Text>
          <Text style={{ color: theme.muted }}>Como você prefere trabalhar?</Text>
          <TextInput
            placeholder="Seu nome"
            value={name}
            onChangeText={setName}
            accessibilityLabel="Seu nome"
            style={{
              backgroundColor: theme.surface,
              borderRadius: theme.radius,
              padding: 14,
              borderWidth: 1,
              borderColor: theme.border,
              color: theme.text,
              minHeight: 48,
            }}
          />
          <Pressable
            onPress={() => void saveTheme('GOOGLE_STYLE')}
            accessibilityRole="button"
            accessibilityLabel="Escolher estilo Google"
            style={{
              padding: 18,
              borderRadius: googleTheme.radius,
              backgroundColor: googleTheme.surface,
              borderWidth: 1,
              borderColor: googleTheme.border,
              minHeight: 48,
            }}
          >
            <Text style={{ fontWeight: '700' }}>Estilo Google</Text>
            <Text style={{ color: googleTheme.muted }}>Leve, claro, cartões arredondados.</Text>
          </Pressable>
          <Pressable
            onPress={() => void saveTheme('MICROSOFT_STYLE')}
            accessibilityRole="button"
            accessibilityLabel="Escolher estilo Microsoft"
            style={{
              padding: 18,
              borderRadius: microsoftTheme.radius,
              backgroundColor: microsoftTheme.surface,
              borderWidth: 1,
              borderColor: microsoftTheme.border,
              minHeight: 48,
            }}
          >
            <Text style={{ fontWeight: '700' }}>Estilo Microsoft</Text>
            <Text style={{ color: microsoftTheme.muted }}>Denso, corporativo, focado em produtividade.</Text>
          </Pressable>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: theme.text }} accessibilityRole="header">
            Conecte suas agendas
          </Text>
          <Text style={{ color: theme.muted }}>
            Conecte Google e/ou Microsoft para sincronizar eventos entre as agendas.
          </Text>
          {connecting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <ActivityIndicator color={theme.primary} />
              <Text style={{ color: theme.muted }}>
                Abrindo {connecting === 'google' ? 'Google' : 'Microsoft'}…
              </Text>
            </View>
          ) : null}
          {connectError ? (
            <Text
              style={{ color: theme.danger, backgroundColor: theme.dangerSurface, padding: 12, borderRadius: 12 }}
              accessibilityRole="alert"
            >
              {connectError}
            </Text>
          ) : null}
          <Button
            label="Conectar Google"
            onPress={() => void connect('google')}
            disabled={Boolean(connecting)}
          />
          <Button
            label="Conectar Microsoft / Outlook"
            onPress={() => void connect('microsoft')}
            variant="ghost"
            disabled={Boolean(connecting)}
          />
          {calendars.length > 0 ? (
            <Button label="Continuar para seleção" onPress={() => setStep(2)} variant="ghost" />
          ) : (
            <Text style={{ color: theme.muted, fontSize: 13 }}>
              Você precisa conectar pelo menos um provedor para continuar.
            </Text>
          )}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: theme.text }} accessibilityRole="header">
            Calendários
          </Text>
          <Text style={{ color: theme.muted }}>
            Escolha quais aparecerão e se novos eventos externos devem bloquear as outras agendas.
          </Text>
          {calendars.length === 0 ? (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.muted }}>Nenhum calendário encontrado ainda.</Text>
              <Button label="Voltar e conectar" onPress={() => setStep(1)} variant="ghost" />
            </View>
          ) : (
            calendars.map((cal) => (
              <Pressable
                key={cal.id}
                onPress={() => {
                  setCalendars((rows) => toggleCalendarEnabled(rows, cal.id));
                  void supabase
                    .from('connected_calendars')
                    .update({ enabled: !cal.enabled })
                    .eq('id', cal.id);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: cal.enabled }}
                accessibilityLabel={`${cal.name}, ${cal.enabled ? 'visível' : 'oculto'}`}
                style={{
                  padding: 14,
                  borderRadius: theme.radius,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: cal.enabled ? cal.color : theme.border,
                  minHeight: 48,
                }}
              >
                <Text style={{ fontWeight: '600', color: theme.text }}>{cal.name}</Text>
                <Text style={{ color: theme.muted }}>{cal.enabled ? 'Visível' : 'Oculto'}</Text>
                <Pressable
                  onPress={() => {
                    setCalendars((rows) => toggleAutoBlockOthers(rows, cal.id));
                    void supabase
                      .from('connected_calendars')
                      .update({ auto_block_others: !cal.auto_block_others })
                      .eq('id', cal.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Auto-bloquear outras agendas: ${cal.auto_block_others ? 'ligado' : 'desligado'}`}
                >
                  <Text style={{ color: theme.primary, marginTop: 8, minHeight: 44 }}>
                    {cal.auto_block_others ? 'Auto-bloquear outras: ligado' : 'Auto-bloquear outras: desligado'}
                  </Text>
                </Pressable>
              </Pressable>
            ))
          )}
          <Button
            label={finishing ? 'Salvando…' : 'Concluir configuração'}
            onPress={() => void finish()}
            disabled={finishing || calendars.length === 0}
          />
          <Button label="Voltar" onPress={() => setStep(1)} variant="ghost" disabled={finishing} />
        </>
      ) : null}

      {step === 3 ? (
        <>
          {(() => {
            const copy = firstSyncCopy({
              status: 'idle',
              enabledCount: enabledCalendarCount(calendars),
            });
            return (
              <>
                <Text
                  style={{ fontSize: 28, fontWeight: '700', color: theme.text }}
                  accessibilityRole="header"
                >
                  {copy.title}
                </Text>
                <Text style={{ color: theme.muted }}>{copy.body}</Text>
              </>
            );
          })()}
          <Text style={{ color: theme.muted }}>
            Calendários ativos: {enabledCalendarCount(calendars)}
          </Text>
          <Button label="Abrir agenda unificada" onPress={() => router.replace('/')} />
        </>
      ) : null}
    </ScrollView>
  );
}

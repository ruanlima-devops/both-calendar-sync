import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useRouter, type Href } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { useEntitlement } from '@/context/entitlement';
import { useToast } from '@/context/toast';
import { statusLabel } from '@/lib/billing/entitlement';
import { openBillingPortal } from '@/lib/billing/client';
import { billingProviderLabel } from '@/lib/billing/purchases';
import { friendlyError } from '@/lib/errors';
import { invokeFunction, supabase } from '@/lib/supabase';
import { listTimezones, timezoneLabel } from '@/lib/timezones';
import type { ColorSchemePreference } from '@/lib/types';

type BoolPref =
  | 'notify_event_created'
  | 'notify_event_updated'
  | 'notify_event_cancelled'
  | 'email_weekly_digest'
  | 'email_monthly_digest';

export default function AccountScreen() {
  const router = useRouter();
  const { session, profile, theme, refreshProfile } = useSession();
  const { showToast } = useToast();
  const { entitlement, subscription } = useEntitlement();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'UTC');
  const [saving, setSaving] = useState(false);
  const [showTzList, setShowTzList] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const email = session?.user.email ?? '';
  const avatarUri =
    profile?.avatar_url ??
    (session?.user.user_metadata?.avatar_url as string | undefined) ??
    (session?.user.user_metadata?.picture as string | undefined) ??
    null;

  const timezones = useMemo(() => listTimezones(), []);

  useEffect(() => {
    setDisplayName(profile?.display_name ?? '');
    setTimezone(profile?.timezone ?? 'UTC');
  }, [profile?.display_name, profile?.timezone]);

  const updateProfile = useCallback(
    async (patch: Record<string, unknown>, toastMessage?: string) => {
      if (!profile) return;
      setSaving(true);
      try {
        const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id);
        if (error) throw error;
        await refreshProfile();
        if (toastMessage) showToast(toastMessage);
      } catch (err) {
        Alert.alert('Unify', friendlyError(err));
      } finally {
        setSaving(false);
      }
    },
    [profile, refreshProfile, showToast],
  );

  async function saveProfile() {
    await updateProfile({ display_name: displayName.trim() || null, timezone }, 'Perfil atualizado');
  }

  async function togglePref(key: BoolPref, value: boolean) {
    await updateProfile({ [key]: value });
  }

  async function setVisualTheme(visual_theme: 'GOOGLE_STYLE' | 'MICROSOFT_STYLE') {
    await updateProfile({ visual_theme }, 'Aparência atualizada');
  }

  async function setColorScheme(color_scheme: ColorSchemePreference) {
    await updateProfile({ color_scheme }, 'Tema atualizado');
  }

  async function deleteAccount() {
    Alert.alert(
      'Excluir conta',
      'Isso remove seu perfil, calendários conectados e todos os eventos. Esta ação não pode ser desfeita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeleting(true);
              try {
                await invokeFunction('delete-account');
                await supabase.auth.signOut();
              } catch (err) {
                Alert.alert('Unify', friendlyError(err, 'Não foi possível excluir a conta.'));
              } finally {
                setDeleting(false);
              }
            })();
          },
        },
      ],
    );
  }

  return (
    <Screen scroll>
      <View style={{ gap: 8 }}>
        <Typography variant="pageTitle">Minha conta</Typography>
        <Typography variant="body" muted>
          Perfil, preferências e notificações
        </Typography>
      </View>

      <Card>
        <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Avatar name={displayName} email={email} uri={avatarUri} size={56} />
          <View style={{ flex: 1, gap: 4 }}>
            <Typography variant="cardTitle">{displayName || 'Sem nome'}</Typography>
            <Typography variant="caption" muted>
              {email}
            </Typography>
          </View>
        </View>
        <Input
          label="Nome de exibição"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Como você quer ser chamado"
          autoCapitalize="words"
        />
        <View>
          <Typography variant="caption">Fuso horário</Typography>
          <Pressable
            onPress={() => setShowTzList((v) => !v)}
            style={{
              marginTop: 4,
              padding: 12,
              borderRadius: theme.radius,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: theme.surface,
              minHeight: 44,
              justifyContent: 'center',
            }}
          >
            <Typography variant="body">{timezoneLabel(timezone)}</Typography>
          </Pressable>
          {showTzList ? (
            <View style={{ maxHeight: 200, marginTop: 8, gap: 4 }}>
              {timezones.slice(0, 40).map((tz) => (
                <Pressable
                  key={tz}
                  onPress={() => {
                    setTimezone(tz);
                    setShowTzList(false);
                  }}
                  style={{ paddingVertical: 8 }}
                >
                  <Typography variant="caption" style={{ color: tz === timezone ? theme.primary : theme.text }}>
                    {timezoneLabel(tz)}
                  </Typography>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        <Button label={saving ? 'Salvando…' : 'Salvar perfil'} onPress={() => void saveProfile()} loading={saving} />
      </Card>

      <Card>
        <Typography variant="sectionTitle">Aparência</Typography>
        <Typography variant="metadata" muted>
          Estilo visual e modo claro/escuro
        </Typography>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(['system', 'light', 'dark'] as const).map((scheme) => (
            <Pressable
              key={scheme}
              onPress={() => void setColorScheme(scheme)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: theme.radius,
                borderWidth: 1,
                borderColor: (profile?.color_scheme ?? 'system') === scheme ? theme.primary : theme.border,
                backgroundColor: (profile?.color_scheme ?? 'system') === scheme ? theme.surfaceMuted : theme.surface,
              }}
            >
              <Typography variant="caption">
                {scheme === 'system' ? 'Sistema' : scheme === 'light' ? 'Claro' : 'Escuro'}
              </Typography>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={() => void setVisualTheme('GOOGLE_STYLE')}
          style={{
            padding: 14,
            borderRadius: 16,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: profile?.visual_theme === 'GOOGLE_STYLE' ? theme.primary : theme.border,
          }}
        >
          <Typography variant="body">Estilo Google</Typography>
          <Typography variant="metadata" muted>
            Espaçoso, cantos arredondados
          </Typography>
        </Pressable>
        <Pressable
          onPress={() => void setVisualTheme('MICROSOFT_STYLE')}
          style={{
            padding: 14,
            borderRadius: 4,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: profile?.visual_theme === 'MICROSOFT_STYLE' ? theme.primary : theme.border,
          }}
        >
          <Typography variant="body">Estilo Microsoft</Typography>
          <Typography variant="metadata" muted>
            Denso, foco em produtividade
          </Typography>
        </Pressable>
      </Card>

      <Card>
        <Typography variant="sectionTitle">Notificações no Unify</Typography>
        <SwitchRow
          label="Novo evento"
          value={profile?.notify_event_created ?? true}
          onValueChange={(v) => void togglePref('notify_event_created', v)}
        />
        <SwitchRow
          label="Evento alterado"
          value={profile?.notify_event_updated ?? true}
          onValueChange={(v) => void togglePref('notify_event_updated', v)}
        />
        <SwitchRow
          label="Evento cancelado"
          value={profile?.notify_event_cancelled ?? true}
          onValueChange={(v) => void togglePref('notify_event_cancelled', v)}
        />
      </Card>

      <Card>
        <Typography variant="sectionTitle">Emails</Typography>
        <SwitchRow
          label="Resumo semanal"
          description="Toda segunda-feira de manhã, no seu fuso horário"
          value={profile?.email_weekly_digest ?? true}
          onValueChange={(v) => void togglePref('email_weekly_digest', v)}
        />
        <SwitchRow
          label="Resumo mensal"
          description="No primeiro dia de cada mês"
          value={profile?.email_monthly_digest ?? true}
          onValueChange={(v) => void togglePref('email_monthly_digest', v)}
        />
      </Card>

      <Card>
        <Typography variant="sectionTitle">Plano e cobrança</Typography>
        <View style={{ gap: 6 }}>
          <Typography variant="caption" muted>
            Plano
          </Typography>
          <Typography variant="body">{subscription?.plan_id === 'unify_pro' ? 'Unify Pro' : subscription?.plan_id ?? '—'}</Typography>
        </View>
        <View style={{ gap: 6 }}>
          <Typography variant="caption" muted>
            Origem
          </Typography>
          <Typography variant="body">{billingProviderLabel(subscription?.billing_provider)}</Typography>
        </View>
        <View style={{ gap: 6 }}>
          <Typography variant="caption" muted>
            Status
          </Typography>
          <Typography variant="body">
            {statusLabel(subscription?.status ?? 'expired', entitlement)}
          </Typography>
        </View>
        {entitlement.trialEndsAt && entitlement.source === 'trial' ? (
          <View style={{ gap: 6 }}>
            <Typography variant="caption" muted>
              Expira em
            </Typography>
            <Typography variant="body">
              {new Date(entitlement.trialEndsAt).toLocaleDateString('pt-BR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Typography>
          </View>
        ) : null}
        {entitlement.currentPeriodEnd && entitlement.source === 'subscription' ? (
          <View style={{ gap: 6 }}>
            <Typography variant="caption" muted>
              {entitlement.cancelAtPeriodEnd ? 'Acesso até' : 'Próxima renovação'}
            </Typography>
            <Typography variant="body">
              {new Date(entitlement.currentPeriodEnd).toLocaleDateString('pt-BR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Typography>
          </View>
        ) : null}
        {!entitlement.hasAccess ? (
          <Button label="Assinar Unify Pro" onPress={() => router.push('/(app)/paywall')} />
        ) : entitlement.source === 'subscription' ? (
          <Button
            label="Gerenciar assinatura"
            variant="secondary"
            onPress={() => {
              void (async () => {
                try {
                  const provider = subscription?.billing_provider;
                  if (provider === 'apple' || (Platform.OS === 'ios' && provider !== 'stripe')) {
                    const { storeManageUrl } = await import('@/lib/billing/purchases');
                    await WebBrowser.openBrowserAsync(storeManageUrl());
                    return;
                  }
                  if (provider === 'google' || (Platform.OS === 'android' && provider !== 'stripe')) {
                    const { storeManageUrl } = await import('@/lib/billing/purchases');
                    await WebBrowser.openBrowserAsync(storeManageUrl());
                    return;
                  }
                  if (Platform.OS !== 'web' && provider === 'stripe') {
                    Alert.alert(
                      'Unify',
                      'Sua assinatura foi feita na Web. Abra o Unify no navegador para gerenciar pelo portal Stripe, ou cancele pelo e-mail de recibo.',
                    );
                    return;
                  }
                  const url = await openBillingPortal();
                  await WebBrowser.openAuthSessionAsync(
                    url,
                    `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/`,
                  );
                } catch (err) {
                  Alert.alert('Unify', friendlyError(err));
                }
              })();
            }}
          />
        ) : entitlement.source === 'trial' ? (
          <Button label="Ver planos" variant="secondary" onPress={() => router.push('/(app)/paywall')} />
        ) : null}
      </Card>

      <Card>
        <Typography variant="sectionTitle">Disponibilidade</Typography>
        <Typography variant="body" muted>
          Calendar Firewall — regras de como seus compromissos aparecem em outras agendas
        </Typography>
        <Button
          label="Configurar disponibilidade"
          variant="secondary"
          onPress={() => router.push('/(app)/availability')}
        />
      </Card>

      <Card>
        <Typography variant="sectionTitle">Agendamento</Typography>
        <Typography variant="body" muted>
          Links públicos para outras pessoas marcarem horários com você
        </Typography>
        <Button
          label="Gerenciar links de agendamento"
          variant="secondary"
          onPress={() => router.push('/(app)/scheduling' as Href)}
        />
      </Card>

      <Card>
        <Typography variant="sectionTitle">Integrações</Typography>
        <Typography variant="body" muted>
          Gerencie Google Calendar e Microsoft Calendar
        </Typography>
        <Button label="Abrir calendários conectados" variant="secondary" onPress={() => router.push('/(app)/(tabs)/calendars')} />
      </Card>

      <Card>
        <Typography variant="sectionTitle">Sessão</Typography>
        <Typography variant="caption" muted>
          Conta conectada via {session?.user.app_metadata.provider ?? 'email'}
        </Typography>
        <Button label="Sair" variant="ghost" onPress={() => void supabase.auth.signOut()} />
      </Card>

      <Card style={{ borderColor: theme.danger, backgroundColor: theme.dangerSurface }}>
        <Typography variant="sectionTitle" style={{ color: theme.danger }}>
          Zona de perigo
        </Typography>
        <Typography variant="body" muted>
          Excluir permanentemente sua conta e todos os dados associados.
        </Typography>
        <Button
          label={deleting ? 'Excluindo…' : 'Excluir minha conta'}
          variant="danger"
          onPress={() => void deleteAccount()}
          loading={deleting}
        />
      </Card>
    </Screen>
  );
}

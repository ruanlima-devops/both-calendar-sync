import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { friendlyError } from '@/lib/errors';
import { connectCalendar } from '@/lib/oauth';
import { invokeFunction, supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import type { ConnectedCalendar, CalendarConnection, ProviderName } from '@/lib/types';

function relativeSync(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `há ${hours} h`;
  return new Date(iso).toLocaleString();
}

function statusLabel(status: CalendarConnection['status']): { text: string; color: string } {
  switch (status) {
    case 'CONNECTED':
      return { text: 'Conectado', color: '#059669' };
    case 'SYNCING':
      return { text: 'Sincronizando', color: '#2563eb' };
    case 'AUTH_REQUIRED':
      return { text: 'Reconectar', color: '#d97706' };
    default:
      return { text: status, color: '#dc2626' };
  }
}

function providerTitle(provider: ProviderName): string {
  if (provider === 'GOOGLE') return 'Google Calendar';
  if (provider === 'MICROSOFT') return 'Microsoft Calendar';
  return 'Apple iCloud';
}

export default function CalendarsScreen() {
  const { theme } = useSession();
  const { showToast } = useToast();
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [calendars, setCalendars] = useState<ConnectedCalendar[]>([]);
  const [connecting, setConnecting] = useState<'google' | 'microsoft' | 'icloud' | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [icloudOpen, setIcloudOpen] = useState(false);
  const [icloudEmail, setIcloudEmail] = useState('');
  const [icloudPassword, setIcloudPassword] = useState('');
  const [icloudReconnectId, setIcloudReconnectId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    const [{ data: cons }, { data: cals }] = await Promise.all([
      supabase.from('calendar_connections').select('*'),
      supabase.from('connected_calendars').select('*'),
    ]);
    setConnections((cons ?? []) as CalendarConnection[]);
    setCalendars((cals ?? []) as ConnectedCalendar[]);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    void invokeFunction('sync-now', { ensureWatchesOnly: true }).catch(() => {});
  }, []);

  async function connect(provider: 'google' | 'microsoft') {
    if (connecting) return;
    setConnecting(provider);
    try {
      await connectCalendar(provider);
      const providerCode = provider === 'google' ? 'GOOGLE' : 'MICROSOFT';
      const { data: cons, error } = await supabase
        .from('calendar_connections')
        .select('*')
        .eq('provider', providerCode);
      if (error) throw error;
      const connected = (cons ?? []).some((row) => row.status === 'CONNECTED');
      if (!connected) {
        throw new Error('A autorização terminou, mas a conexão não foi salva. Tente novamente.');
      }
      await load();
      showToast(provider === 'microsoft' ? 'Microsoft conectado' : 'Google conectado');
    } catch (err) {
      Alert.alert('Both', friendlyError(err, 'Não foi possível conectar o calendário.'));
    } finally {
      setConnecting(null);
    }
  }

  function openIcloud(reconnectId?: string) {
    setIcloudReconnectId(reconnectId ?? null);
    setIcloudEmail('');
    setIcloudPassword('');
    setShowHelp(false);
    setIcloudOpen(true);
  }

  async function submitIcloud() {
    if (connecting) return;
    setConnecting('icloud');
    try {
      await invokeFunction('icloud-connect', {
        action: icloudReconnectId ? 'update_credential' : 'connect',
        connectionId: icloudReconnectId ?? undefined,
        appleEmail: icloudEmail.trim(),
        appSpecificPassword: icloudPassword,
      });
      setIcloudOpen(false);
      setIcloudPassword('');
      await load();
      showToast('Apple iCloud conectado');
    } catch (err) {
      Alert.alert('Both', friendlyError(err, 'Não foi possível conectar o iCloud.'));
    } finally {
      setConnecting(null);
    }
  }

  async function syncNow(connectionId: string) {
    if (syncingId) return;
    setSyncingId(connectionId);
    try {
      const result = await invokeFunction<{ failed?: number }>(
        'sync-now',
        { connectionId },
      );
      await load();
      showToast('Sincronização concluída');
      if (result.failed && result.failed > 0) {
        Alert.alert('Sincronização parcial', 'Alguns calendários não sincronizaram.');
      }
    } catch (err) {
      await load();
      Alert.alert('Sincronização', friendlyError(err));
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 720, alignSelf: 'center', width: '100%' }}>
      <View>
        <Typography variant="pageTitle">Calendários</Typography>
        <Typography variant="body" muted>
          Conecte suas agendas e escolha quais ficam visíveis
        </Typography>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button
            label={connecting === 'google' ? 'Conectando…' : 'Conectar Google'}
            onPress={() => void connect('google')}
            disabled={connecting !== null}
            loading={connecting === 'google'}
          />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button
            label={connecting === 'microsoft' ? 'Conectando…' : 'Conectar Microsoft'}
            onPress={() => void connect('microsoft')}
            variant="secondary"
            disabled={connecting !== null}
            loading={connecting === 'microsoft'}
          />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Button
            label={connecting === 'icloud' ? 'Conectando…' : 'Conectar iCloud'}
            onPress={() => openIcloud()}
            variant="secondary"
            disabled={connecting !== null}
            loading={connecting === 'icloud'}
          />
        </View>
      </View>

      {connections.length === 0 ? (
        <EmptyState
          title="Nenhuma agenda conectada"
          description="Conecte Google, Microsoft ou Apple iCloud para sincronizar seus compromissos."
        />
      ) : null}

      {connections.map((conn) => {
        const status = statusLabel(conn.status);
        const activeCount = calendars.filter((c) => c.connection_id === conn.id && c.enabled).length;
        return (
          <Card key={conn.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ gap: 4, flex: 1 }}>
                <Typography variant="cardTitle">{providerTitle(conn.provider)}</Typography>
                <Typography variant="caption" muted>
                  {conn.account_email}
                </Typography>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: status.color }} />
                <Typography variant="caption" style={{ color: status.color }}>
                  {status.text}
                </Typography>
              </View>
            </View>
            <Typography variant="metadata" muted>
              Sincronização automática · Última sync: {relativeSync(conn.last_sync_at)} · {activeCount}{' '}
              calendário{activeCount === 1 ? '' : 's'} ativo{activeCount === 1 ? '' : 's'}
            </Typography>
            {conn.last_sync_error ? (
              <Typography variant="metadata" style={{ color: theme.danger }}>
                {friendlyError(conn.last_sync_error)}
              </Typography>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <View style={{ flex: 1, minWidth: 120 }}>
                <Button
                  label={syncingId === conn.id ? 'Sincronizando…' : 'Sincronizar'}
                  onPress={() => void syncNow(conn.id)}
                  variant="secondary"
                  disabled={syncingId !== null}
                  loading={syncingId === conn.id}
                />
              </View>
              {conn.status === 'AUTH_REQUIRED' ? (
                <View style={{ flex: 1, minWidth: 120 }}>
                  <Button
                    label="Reconectar"
                    onPress={() => {
                      if (conn.provider === 'ICLOUD') openIcloud(conn.id);
                      else void connect(conn.provider === 'GOOGLE' ? 'google' : 'microsoft');
                    }}
                  />
                </View>
              ) : null}
              <View style={{ flex: 1, minWidth: 120 }}>
                <Button
                  label="Desconectar"
                  variant="ghost"
                  onPress={() => {
                    Alert.alert(
                      'Desconectar',
                      conn.provider === 'ICLOUD'
                        ? 'Remover esta conta? Você também pode revogar a senha específica de app em account.apple.com.'
                        : 'Remover esta conta?',
                      [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                          text: 'Desconectar',
                          style: 'destructive',
                          onPress: () =>
                            void invokeFunction('disconnect-calendar', { connectionId: conn.id })
                              .then(load)
                              .then(() => showToast('Conta desconectada')),
                        },
                      ],
                    );
                  }}
                />
              </View>
            </View>
            {calendars.filter((c) => c.connection_id === conn.id).map((cal) => (
              <Pressable
                key={cal.id}
                onPress={() =>
                  void supabase
                    .from('connected_calendars')
                    .update({ enabled: !cal.enabled })
                    .eq('id', cal.id)
                    .then(load)
                }
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flex: 1 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cal.color }} />
                  <Typography variant="body">{cal.name}</Typography>
                  {!['owner', 'writer', 'editor'].includes(String(cal.access_role).toLowerCase()) ? (
                    <Typography variant="metadata" muted>
                      só leitura
                    </Typography>
                  ) : null}
                </View>
                <Typography variant="caption" muted>
                  {cal.enabled ? 'Visível' : 'Oculto'}
                </Typography>
              </Pressable>
            ))}
          </Card>
        );
      })}

      <Modal visible={icloudOpen} animationType="slide" transparent onRequestClose={() => setIcloudOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: theme.surface,
              borderTopLeftRadius: theme.radius,
              borderTopRightRadius: theme.radius,
              padding: space.lg,
              gap: space.md,
              maxHeight: '92%',
            }}
          >
            <Typography variant="pageTitle">Conectar iCloud Calendar</Typography>
            <Typography variant="body" muted>
              Para conectar com segurança, use uma senha específica de app da sua Conta Apple. Sua senha
              principal da Apple nunca é enviada ao Both.
            </Typography>

            <Pressable onPress={() => setShowHelp((v) => !v)}>
              <Typography variant="caption" style={{ color: theme.primary }}>
                Como gerar uma senha específica de app?
              </Typography>
            </Pressable>
            {showHelp ? (
              <View style={{ gap: 6 }}>
                <Typography variant="caption" muted>
                  1. Abra account.apple.com
                </Typography>
                <Typography variant="caption" muted>
                  2. Acesse Início de sessão e segurança
                </Typography>
                <Typography variant="caption" muted>
                  3. Escolha Senhas específicas de apps
                </Typography>
                <Typography variant="caption" muted>
                  4. Gere uma senha chamada “Both”
                </Typography>
                <Typography variant="caption" muted>
                  5. Cole a senha abaixo
                </Typography>
                <Button
                  label="Abrir account.apple.com"
                  variant="ghost"
                  onPress={() => void Linking.openURL('https://account.apple.com/account/manage')}
                />
              </View>
            ) : null}

            <TextInput
              placeholder="Email da Conta Apple"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={icloudEmail}
              onChangeText={setIcloudEmail}
              autoComplete="off"
              textContentType="username"
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: theme.radius,
                padding: space.md,
                color: theme.text,
                backgroundColor: theme.bg,
              }}
            />
            <TextInput
              placeholder="Senha específica de app"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              secureTextEntry
              value={icloudPassword}
              onChangeText={setIcloudPassword}
              autoComplete="off"
              textContentType="password"
              style={{
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: theme.radius,
                padding: space.md,
                color: theme.text,
                backgroundColor: theme.bg,
              }}
            />

            <Button
              label="Conectar iCloud"
              loading={connecting === 'icloud'}
              disabled={!icloudEmail.trim() || !icloudPassword.trim()}
              onPress={() => void submitIcloud()}
            />
            <Button label="Cancelar" variant="ghost" onPress={() => setIcloudOpen(false)} />
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

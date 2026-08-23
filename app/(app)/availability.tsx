import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { useToast } from '@/context/toast';
import { FIREWALL_PRESETS, type FirewallPrivacyPreset, type FirewallRuleRow } from '@/lib/firewall/presets';
import { isWritableAccessRole } from '@/lib/events/create';
import { friendlyError } from '@/lib/errors';
import { invokeFunction, supabase } from '@/lib/supabase';
import { space } from '@/lib/theme';
import type { CalendarConnection, ConnectedCalendar, ProviderName } from '@/lib/types';

type Cal = ConnectedCalendar & { provider: ProviderName; accountEmail: string | null };

export default function AvailabilityScreen() {
  const { theme } = useSession();
  const { showToast } = useToast();
  const router = useRouter();

  const [calendars, setCalendars] = useState<Cal[]>([]);
  const [rules, setRules] = useState<FirewallRuleRow[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [destId, setDestId] = useState('');
  const [preset, setPreset] = useState<FirewallPrivacyPreset>('availability');
  const [ignoreFree, setIgnoreFree] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: cals }, { data: cons }] = await Promise.all([
      supabase.from('connected_calendars').select('*').eq('enabled', true),
      supabase.from('calendar_connections').select('*'),
    ]);
    const { data: ruleRows } = await supabase.from('calendar_firewall_rules').select('*').order('created_at');
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
    setRules((ruleRows as FirewallRuleRow[]) ?? []);
    if (!sourceId && mapped[0]) setSourceId(mapped[0].id);
    const writableOther = mapped.filter(
      (c) => c.id !== (sourceId || mapped[0]?.id) && isWritableAccessRole(c.access_role),
    );
    if (!destId && writableOther[0]) setDestId(writableOther[0].id);
  }, [destId, sourceId]);

  useEffect(() => {
    void load();
  }, []);

  const destinations = useMemo(
    () => calendars.filter((c) => c.id !== sourceId && isWritableAccessRole(c.access_role)),
    [calendars, sourceId],
  );

  const source = calendars.find((c) => c.id === sourceId);
  const dest = calendars.find((c) => c.id === destId);

  function selectRule(rule: FirewallRuleRow) {
    setEditingId(rule.id);
    setSourceId(rule.source_calendar_id);
    setDestId(rule.destination_calendar_id);
    setPreset(rule.privacy_preset);
    setIgnoreFree(rule.ignore_free);
  }

  async function save() {
    if (!sourceId || !destId) {
      Alert.alert('Unify', 'Escolha origem e destino.');
      return;
    }
    setBusy(true);
    try {
      const presetFlags = FIREWALL_PRESETS.find((p) => p.id === preset)?.flags;
      await invokeFunction('firewall-rules', {
        id: editingId ?? undefined,
        sourceCalendarId: sourceId,
        destinationCalendarId: destId,
        enabled: true,
        privacyPreset: preset,
        syncTitle: presetFlags?.sync_title,
        syncDescription: presetFlags?.sync_description,
        syncLocation: presetFlags?.sync_location,
        ignoreFree,
      });
      showToast('Regra salva');
      setEditingId(null);
      await load();
    } catch (err) {
      Alert.alert('Unify', friendlyError(err, 'Não foi possível salvar a regra.'));
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: FirewallRuleRow, enabled: boolean) {
    if (!enabled) {
      Alert.alert(
        'Desativar sincronização?',
        'Os horários reservados automaticamente por esta regra serão removidos do calendário de destino.',
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Desativar',
            style: 'destructive',
            onPress: () => void persistToggle(rule, false),
          },
        ],
      );
      return;
    }
    await persistToggle(rule, true);
  }

  async function persistToggle(rule: FirewallRuleRow, enabled: boolean) {
    setBusy(true);
    try {
      await invokeFunction('firewall-rules', {
        id: rule.id,
        enabled,
        removeMirrors: !enabled,
      });
      showToast(enabled ? 'Regra ativada' : 'Regra desativada');
      await load();
    } catch (err) {
      Alert.alert('Unify', friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(rule: FirewallRuleRow) {
    Alert.alert('Excluir regra?', 'Os bloqueios gerenciados por esta regra serão removidos.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy(true);
            try {
              await invokeFunction('firewall-rules', { action: 'delete', id: rule.id });
              showToast('Regra removida');
              await load();
            } catch (err) {
              Alert.alert('Unify', friendlyError(err));
            } finally {
              setBusy(false);
            }
          })(),
      },
    ]);
  }

  function labelFor(cal?: Cal) {
    if (!cal) return '—';
    const provider = cal.provider === 'GOOGLE' ? 'Google' : 'Microsoft';
    return `${provider} · ${cal.name}`;
  }

  return (
    <Screen scroll>
      <View style={{ gap: space.xs }}>
        <Typography variant="pageTitle">Disponibilidade</Typography>
        <Typography variant="body" muted>
          Calendar Firewall: defina como os compromissos de uma agenda aparecem em outra — por direção, com
          privacidade sob seu controle.
        </Typography>
      </View>

      <View style={{ gap: space.sm }}>
        <Typography variant="sectionTitle">Regras ativas</Typography>
        {rules.length === 0 ? (
          <Typography variant="body" muted>
            Nenhuma regra ainda. Crie a primeira abaixo (padrão: apenas disponibilidade).
          </Typography>
        ) : (
          rules.map((rule) => {
            const src = calendars.find((c) => c.id === rule.source_calendar_id);
            const dst = calendars.find((c) => c.id === rule.destination_calendar_id);
            return (
              <Pressable
                key={rule.id}
                onPress={() => selectRule(rule)}
                style={{
                  padding: 14,
                  borderRadius: theme.radius,
                  borderWidth: 1,
                  borderColor: editingId === rule.id ? theme.primary : theme.border,
                  backgroundColor: theme.surface,
                  gap: 8,
                }}
              >
                <Typography variant="body">
                  {labelFor(src)} → {labelFor(dst)}
                </Typography>
                <Typography variant="metadata" muted>
                  {FIREWALL_PRESETS.find((p) => p.id === rule.privacy_preset)?.label ?? rule.privacy_preset}
                  {rule.enabled ? '' : ' · pausada'}
                </Typography>
                <SwitchRow
                  label={rule.enabled ? 'Ativa' : 'Pausada'}
                  value={rule.enabled}
                  onValueChange={(v) => void toggleRule(rule, v)}
                  disabled={busy}
                />
                <Button label="Excluir regra" variant="ghost" onPress={() => void removeRule(rule)} disabled={busy} />
              </Pressable>
            );
          })
        )}
      </View>

      <View
        style={{
          gap: space.md,
          padding: 14,
          borderRadius: theme.radius,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
        }}
      >
        <Typography variant="sectionTitle">{editingId ? 'Editar regra' : 'Nova regra'}</Typography>

        <Typography variant="caption" muted>
          Origem
        </Typography>
        {calendars.map((cal) => (
          <Pressable key={cal.id} onPress={() => setSourceId(cal.id)}>
            <Typography variant="body" style={{ color: sourceId === cal.id ? theme.primary : theme.text }}>
              {sourceId === cal.id ? '● ' : '○ '}
              {labelFor(cal)}
              {cal.accountEmail ? ` · ${cal.accountEmail}` : ''}
            </Typography>
          </Pressable>
        ))}

        <Typography variant="caption" muted style={{ marginTop: space.sm }}>
          Destino
        </Typography>
        {destinations.length === 0 ? (
          <Typography variant="body" muted>
            Conecte outra agenda com permissão de escrita.
          </Typography>
        ) : (
          destinations.map((cal) => (
            <Pressable key={cal.id} onPress={() => setDestId(cal.id)}>
              <Typography variant="body" style={{ color: destId === cal.id ? theme.primary : theme.text }}>
                {destId === cal.id ? '● ' : '○ '}
                {labelFor(cal)}
              </Typography>
            </Pressable>
          ))
        )}

        <Typography variant="sectionTitle" style={{ marginTop: space.sm }}>
          Como aparece em {dest ? labelFor(dest) : 'destino'}?
        </Typography>
        {FIREWALL_PRESETS.map((p) => (
          <Pressable key={p.id} onPress={() => setPreset(p.id)} style={{ gap: 4, paddingVertical: 6 }}>
            <Typography variant="body" style={{ color: preset === p.id ? theme.primary : theme.text }}>
              {preset === p.id ? '● ' : '○ '}
              {p.label}
            </Typography>
            <Typography variant="metadata" muted>
              {p.description}
            </Typography>
          </Pressable>
        ))}

        <SwitchRow
          label="Ignorar eventos livres (free)"
          description="Não reservar horário quando o compromisso original estiver marcado como livre."
          value={ignoreFree}
          onValueChange={setIgnoreFree}
        />

        <Button
          label={busy ? 'Salvando…' : 'Salvar regra'}
          onPress={() => void save()}
          loading={busy}
          disabled={busy || !sourceId || !destId}
        />
        {editingId ? (
          <Button
            label="Nova regra"
            variant="ghost"
            onPress={() => {
              setEditingId(null);
              setPreset('availability');
            }}
          />
        ) : null}
      </View>

      <Button label="Voltar" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

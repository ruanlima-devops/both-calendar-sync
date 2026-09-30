import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Screen } from '@/components/ui/Screen';
import { Typography } from '@/components/ui/Typography';
import { useSession } from '@/context/session';
import { deleteAccountAndSignOut } from '@/lib/account/client';
import {
  DELETE_ACCOUNT_CONFIRM_WORD,
  isDeleteAccountConfirmPhrase,
} from '@/lib/account/delete-account';
import { friendlyError } from '@/lib/errors';
import { space } from '@/lib/theme';

export default function DeleteAccountPage() {
  const router = useRouter();
  const { session, theme, status } = useSession();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    if (!isDeleteAccountConfirmPhrase(confirm)) {
      setError(`Digite ${DELETE_ACCOUNT_CONFIRM_WORD} para confirmar.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteAccountAndSignOut();
      setDone(true);
    } catch (err) {
      setError(friendlyError(err, 'Não foi possível excluir a conta.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Typography variant="pageTitle">Excluir conta Both</Typography>
      <Typography variant="body" muted>
        Esta página permite solicitar a exclusão permanente da sua conta Both, incluindo perfil,
        calendários conectados, eventos sincronizados, preferências e notificações in-app.
      </Typography>
      <Typography variant="body" muted>
        Tokens de calendário são removidos do backend. Registros mínimos de cobrança podem ser
        retidos quando a lei exigir. A operação não pode ser desfeita.
      </Typography>

      {done ? (
        <View style={{ gap: space.sm }}>
          <Typography variant="sectionTitle">Conta excluída.</Typography>
          <Button label="Ir para login" onPress={() => router.replace('/(auth)/login')} />
        </View>
      ) : status === 'loading' ? (
        <Typography variant="body" muted>
          Carregando…
        </Typography>
      ) : !session ? (
        <View style={{ gap: space.sm }}>
          <Typography variant="body">Entre na sua conta Both para solicitar a exclusão.</Typography>
          <Button label="Ir para login" onPress={() => router.push('/(auth)/login')} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <Typography variant="body">Conta: {session.user.email ?? session.user.id}</Typography>
          <Input
            label={`Digite ${DELETE_ACCOUNT_CONFIRM_WORD} para confirmar`}
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
            editable={!busy}
          />
          {error ? (
            <Typography variant="caption" style={{ color: theme.danger }}>
              {error}
            </Typography>
          ) : null}
          <Button
            label={busy ? 'Excluindo…' : 'Excluir minha conta permanentemente'}
            variant="danger"
            loading={busy}
            disabled={busy}
            onPress={() => void submit()}
          />
        </View>
      )}
    </Screen>
  );
}

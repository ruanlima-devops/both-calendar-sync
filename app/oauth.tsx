import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Typography } from '@/components/ui/Typography';
import { showMessage } from '@/lib/confirm';
import { friendlyError } from '@/lib/errors';
import { finalizeCalendarOAuth } from '@/lib/oauth';
import {
  isOAuthPopupReturn,
  notifyOAuthOpener,
  persistOAuthComplete,
  takeOAuthNonce,
  withoutOAuthTicket,
  type OAuthCompletePayload,
} from '@/lib/oauth-complete';

export default function OAuthComplete() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    oauth_error?: string;
    oauth_ticket?: string;
    provider?: string;
    popup?: string;
  }>();
  const [popupFinished, setPopupFinished] = useState(false);

  useEffect(() => {
    const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
    const error = first(params.oauth_error);
    const ticket = first(params.oauth_ticket) ?? null;
    const providerParam = first(params.provider);
    const provider =
      providerParam === 'google' || providerParam === 'microsoft' ? providerParam : null;
    const payload: OAuthCompletePayload = {
      ok: !error && Boolean(ticket),
      provider,
      error: error ?? (ticket ? null : 'invalid_ticket'),
      ticket,
    };
    const goToCalendars = () => router.replace('/(app)/(tabs)/calendars');

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (ticket) window.history.replaceState(window.history.state, '', withoutOAuthTicket(window.location.href));
      const delivered = notifyOAuthOpener(payload);
      if (delivered || isOAuthPopupReturn({ popupParam: first(params.popup), windowName: window.name })) {
        persistOAuthComplete(payload);
        window.close();
        setPopupFinished(true);
        return;
      }

      // Same-tab return: only the tab holding this flow's client nonce can finalize it.
      if (payload.ok && provider && ticket) {
        const nonce = takeOAuthNonce(window.sessionStorage, provider);
        if (nonce) {
          void finalizeCalendarOAuth(provider, ticket, nonce)
            .then(() => persistOAuthComplete({ ok: true, provider, error: null, ticket: null }))
            .catch((err) => showMessage('Both', friendlyError(err, 'Não foi possível conectar o calendário.')))
            .finally(goToCalendars);
          return;
        }
        showMessage('Both', friendlyError(new Error('invalid_ticket')));
        goToCalendars();
        return;
      }
    }

    if (error && error !== 'access_denied') {
      const label = provider === 'microsoft' ? 'Microsoft' : 'Google';
      showMessage('Both', `Não foi possível conectar sua conta ${label}. Tente novamente.`);
    }
    goToCalendars();
  }, [params.oauth_error, params.oauth_ticket, params.provider, params.popup, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      {popupFinished ? (
        <Typography variant="body">Pronto. Você já pode fechar esta janela e voltar ao Both.</Typography>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  );
}

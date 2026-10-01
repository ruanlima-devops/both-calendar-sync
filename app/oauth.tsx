import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Typography } from '@/components/ui/Typography';
import { showMessage } from '@/lib/confirm';
import {
  isOAuthPopupReturn,
  notifyOAuthOpener,
  persistOAuthComplete,
  type OAuthCompletePayload,
} from '@/lib/oauth-complete';

export default function OAuthComplete() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    oauth_error?: string;
    connected?: string;
    provider?: string;
    popup?: string;
  }>();
  const [popupFinished, setPopupFinished] = useState(false);

  useEffect(() => {
    const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
    const error = first(params.oauth_error);
    const connected = first(params.connected);
    const providerParam = first(params.provider);
    const provider = (connected ?? providerParam ?? null) as OAuthCompletePayload['provider'];
    const payload: OAuthCompletePayload = {
      ok: !error,
      provider,
      error: error ?? null,
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      persistOAuthComplete(payload);
      const delivered = notifyOAuthOpener(payload);
      if (delivered || isOAuthPopupReturn({ popupParam: first(params.popup), windowName: window.name })) {
        window.close();
        setPopupFinished(true);
        return;
      }
    }

    if (error && error !== 'access_denied') {
      const label = provider === 'microsoft' ? 'Microsoft' : 'Google';
      showMessage('Both', `Não foi possível conectar sua conta ${label}. Tente novamente.`);
    }
    router.replace('/(app)/(tabs)/calendars');
  }, [params.connected, params.oauth_error, params.provider, params.popup, router]);

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

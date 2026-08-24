import { useEffect } from 'react';
import { ActivityIndicator, Alert, Platform, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

const MESSAGE_TYPE = 'unify-calendar-oauth';

export default function OAuthComplete() {
  const router = useRouter();
  const params = useLocalSearchParams<{ oauth_error?: string; connected?: string; provider?: string }>();

  useEffect(() => {
    const error = Array.isArray(params.oauth_error) ? params.oauth_error[0] : params.oauth_error;
    const connected = Array.isArray(params.connected) ? params.connected[0] : params.connected;
    const providerParam = Array.isArray(params.provider) ? params.provider[0] : params.provider;
    const provider = connected ?? providerParam ?? null;
    const ok = !error;

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.opener && window.opener !== window) {
      window.opener.postMessage(
        {
          type: MESSAGE_TYPE,
          ok,
          provider,
          error: error ?? null,
        },
        window.location.origin,
      );
      window.close();
      return;
    }

    if (error && error !== 'access_denied') {
      const label = provider === 'microsoft' ? 'Microsoft' : 'Google';
      Alert.alert('Both', `Não foi possível conectar sua conta ${label}. Tente novamente.`);
    }
    router.replace('/(app)/(tabs)/calendars');
  }, [params.connected, params.oauth_error, params.provider, router]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      setOffline(!(state.isConnected && state.isInternetReachable !== false));
    });
    return () => sub();
  }, []);

  if (!offline) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + 4,
        left: 12,
        right: 12,
        zIndex: 100,
        backgroundColor: '#111827',
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
      }}
      accessibilityLiveRegion="polite"
    >
      <Text style={{ color: '#f8fafc', textAlign: 'center', fontSize: 13, fontWeight: '600' }}>
        Sem conexão — mostrando os dados mais recentes disponíveis.
      </Text>
    </View>
  );
}

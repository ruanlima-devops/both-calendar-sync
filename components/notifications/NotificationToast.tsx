import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '@/context/notifications';
import { useSession } from '@/context/session';
import { notificationPreview, providerLabel } from '@/lib/notifications';

export function NotificationToast() {
  const { theme } = useSession();
  const insets = useSafeAreaInsets();
  const { toast, openNotification, dismissToast } = useNotifications();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 4500);
    return () => clearTimeout(timer);
  }, [dismissToast, toast]);

  if (!toast) return null;
  const preview = notificationPreview(toast);

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: Math.max(insets.top, 12) + 8, left: 16, right: 16, alignItems: 'center', zIndex: 50 }}
    >
      <Pressable
        onPress={() => void openNotification(toast)}
        accessibilityRole="button"
        accessibilityLabel={`${providerLabel(toast.provider)}. ${toast.title}. ${preview.headline}`}
        style={{
          width: '100%',
          maxWidth: 420,
          backgroundColor: theme.surface,
          borderRadius: theme.radius,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600' }}>{providerLabel(toast.provider)}</Text>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', marginTop: 2 }}>{toast.title}</Text>
        <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
          {preview.headline}{preview.detail ? ` · ${preview.detail}` : ''}
        </Text>
      </Pressable>
    </View>
  );
}

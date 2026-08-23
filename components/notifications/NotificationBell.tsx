import { Pressable, Text, View } from 'react-native';
import { useNotifications } from '@/context/notifications';
import { useSession } from '@/context/session';
import { notificationsA11yLabel, unreadBadgeLabel } from '@/lib/notifications';

export function NotificationBell() {
  const { theme } = useSession();
  const { unreadCount, openCenter } = useNotifications();
  const badge = unreadBadgeLabel(unreadCount);

  return (
    <Pressable
      onPress={openCenter}
      accessibilityRole="button"
      accessibilityLabel={notificationsA11yLabel(unreadCount)}
      style={{ paddingHorizontal: 16, paddingVertical: 8, minWidth: 44, minHeight: 44, justifyContent: 'center' }}
    >
      <View>
        <Text style={{ fontSize: 18, color: theme.text }}>🔔</Text>
        {badge ? (
          <View
            style={{
              position: 'absolute',
              top: -6,
              right: -10,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              paddingHorizontal: 4,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: theme.primaryText, fontSize: 10, fontWeight: '700' }}>{badge}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

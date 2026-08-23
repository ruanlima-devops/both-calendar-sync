import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNotifications } from '@/context/notifications';
import { useSession } from '@/context/session';
import {
  groupNotifications,
  notificationPreview,
  providerLabel,
  relativeTime,
  type AppNotification,
} from '@/lib/notifications';

function NotificationRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: () => void;
}) {
  const { theme } = useSession();
  const unread = !item.read_at;
  const preview = notificationPreview(item);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: unread }}
      accessibilityLabel={`${unread ? 'Não lida. ' : ''}${providerLabel(item.provider)}. ${item.title}. ${preview.headline}`}
      style={{
        flexDirection: 'row',
        paddingVertical: 14,
        paddingHorizontal: 4,
        minHeight: 44,
      }}
    >
      <View
        style={{
          width: 8,
          alignItems: 'center',
          paddingTop: 7,
        }}
      >
        <View
          style={{
            width: unread ? 8 : 0,
            height: unread ? 8 : 0,
            borderRadius: 4,
            backgroundColor: theme.primary,
          }}
        />
      </View>
      <View style={{ flex: 1, paddingLeft: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '600' }}>{providerLabel(item.provider)}</Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>{relativeTime(item.created_at)}</Text>
        </View>
        <Text style={{ color: theme.text, fontSize: 15, fontWeight: unread ? '700' : '600', marginTop: 2 }}>{item.title}</Text>
        <Text style={{ color: theme.text, fontSize: 14, marginTop: 2, opacity: 0.9 }}>{preview.headline}</Text>
        {preview.detail ? (
          <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>{preview.detail}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function NotificationCenter() {
  const { theme, profile } = useSession();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const web = Platform.OS === 'web' && width >= 720;
  const tz = profile?.timezone ?? 'UTC';
  const {
    items,
    unreadCount,
    loadState,
    filter,
    centerOpen,
    hasMore,
    loadingMore,
    setFilter,
    closeCenter,
    refresh,
    loadMore,
    markAllRead,
    openNotification,
  } = useNotifications();

  const visible = filter === 'unread' ? items.filter((item) => !item.read_at) : items;
  const groups = groupNotifications(visible, tz);

  const panel = (
    <View
      style={{
        backgroundColor: theme.surface,
        width: web ? 400 : '100%',
        maxHeight: web ? Math.min(640, height - 80) : height,
        height: web ? undefined : height,
        borderRadius: web ? theme.radius : 0,
        borderWidth: web ? 1 : 0,
        borderColor: theme.border,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          paddingTop: web ? 18 : insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {!web ? (
            <Pressable onPress={closeCenter} accessibilityLabel="Fechar" style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: theme.primary, fontSize: 16 }}>Fechar</Text>
            </Pressable>
          ) : null}
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '700' }}>Notificações</Text>
        </View>
        {unreadCount > 0 ? (
          <Pressable onPress={() => void markAllRead()} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: theme.primary, fontSize: 14, fontWeight: '600' }}>Marcar todas como lidas</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 8 }}>
        {(['all', 'unread'] as const).map((key) => {
          const active = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                minHeight: 36,
                borderRadius: 999,
                backgroundColor: active ? theme.bg : 'transparent',
              }}
            >
              <Text style={{ color: active ? theme.text : theme.muted, fontWeight: '600', fontSize: 13 }}>
                {key === 'all' ? 'Todas' : 'Não lidas'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loadState === 'loading' ? (
        <View style={{ padding: 40, alignItems: 'center' }}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : loadState === 'error' ? (
        <View style={{ padding: 32, alignItems: 'center', gap: 12 }}>
          <Text style={{ color: theme.text, textAlign: 'center' }}>Não foi possível carregar suas notificações.</Text>
          <Pressable onPress={() => void refresh()}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>Tente novamente</Text>
          </Pressable>
        </View>
      ) : groups.length === 0 ? (
        <View style={{ paddingHorizontal: 28, paddingVertical: 48, alignItems: 'center' }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: '700' }}>Tudo em dia</Text>
          <Text style={{ color: theme.muted, fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
            {filter === 'unread'
              ? 'Você não tem notificações não lidas.'
              : 'Novidades dos seus calendários aparecerão aqui.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28 }}>
          {groups.map((group) => (
            <View key={group.label} style={{ marginTop: 12 }}>
              <Text style={{ color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 8 }}>
                {group.label.toUpperCase()}
              </Text>
              {group.items.map((item) => (
                <NotificationRow key={item.id} item={item} onPress={() => void openNotification(item)} />
              ))}
            </View>
          ))}
          {hasMore ? (
            <Pressable onPress={() => void loadMore()} style={{ paddingVertical: 16, alignItems: 'center' }}>
              {loadingMore ? <ActivityIndicator color={theme.primary} /> : (
                <Text style={{ color: theme.primary, fontWeight: '600' }}>Carregar mais</Text>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );

  return (
    <Modal visible={centerOpen} transparent animationType={web ? 'fade' : 'slide'} onRequestClose={closeCenter}>
      <View style={{ flex: 1, backgroundColor: web ? 'rgba(15,23,42,0.28)' : theme.bg }}>
        <Pressable style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} onPress={closeCenter} />
        <View
          pointerEvents="box-none"
          style={{
            flex: 1,
            alignItems: web ? 'flex-end' : 'stretch',
            paddingTop: web ? 56 : 0,
            paddingRight: web ? 16 : 0,
          }}
        >
          {panel}
        </View>
      </View>
    </Modal>
  );
}

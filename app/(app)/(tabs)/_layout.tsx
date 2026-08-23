import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { TrialBanner } from '@/components/billing/TrialBanner';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useSession } from '@/context/session';

export default function TabLayout() {
  const { theme } = useSession();
  return (
    <View style={{ flex: 1 }}>
      <TrialBanner />
      <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTitleStyle: { color: theme.text },
        headerRight: () => <NotificationBell />,
        tabBarActiveTintColor: theme.primary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarPosition: Platform.OS === 'web' && theme.sidebar ? 'left' : 'bottom',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Agenda', tabBarIcon: () => <Text>▦</Text> }} />
      <Tabs.Screen name="calendars" options={{ title: 'Calendários', tabBarIcon: () => <Text>☰</Text> }} />
      <Tabs.Screen name="settings" options={{ title: 'Conta', tabBarIcon: () => <Text>👤</Text> }} />
    </Tabs>
    </View>
  );
}

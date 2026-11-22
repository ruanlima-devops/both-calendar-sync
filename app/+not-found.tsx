import { Link, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Página não encontrada' }} />
      <View style={styles.container}>
        <Text style={styles.brand}>Both</Text>
        <Text style={styles.title}>Esta página não existe.</Text>
        <Text style={styles.body}>Volte à agenda ou abra o Both pelo endereço principal.</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Ir para o início</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  brand: {
    fontSize: 28,
    fontWeight: '700',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
    maxWidth: 320,
  },
  link: {
    marginTop: 16,
    paddingVertical: 12,
  },
  linkText: {
    fontSize: 14,
    color: '#0F766E',
    fontWeight: '600',
  },
});

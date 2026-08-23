import { Image, Text, View } from 'react-native';
import { useSession } from '@/context/session';

function initials(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? email ?? '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function Avatar({
  name,
  email,
  uri,
  size = 48,
}: {
  name?: string | null;
  email?: string | null;
  uri?: string | null;
  size?: number;
}) {
  const { theme } = useSession();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityLabel="Foto do perfil"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: theme.primaryText, fontWeight: '700', fontSize: size * 0.34 }}>
        {initials(name, email)}
      </Text>
    </View>
  );
}

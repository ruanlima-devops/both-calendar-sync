import { Text, type TextProps, type TextStyle } from 'react-native';
import { useSession } from '@/context/session';
import { type } from '@/lib/theme';

type Variant = 'pageTitle' | 'sectionTitle' | 'cardTitle' | 'body' | 'caption' | 'metadata';

const sizes: Record<Variant, number> = {
  pageTitle: type.pageTitle,
  sectionTitle: type.sectionTitle,
  cardTitle: type.cardTitle,
  body: type.body,
  caption: type.caption,
  metadata: type.metadata,
};

const weights: Record<Variant, TextStyle['fontWeight']> = {
  pageTitle: '700',
  sectionTitle: '600',
  cardTitle: '600',
  body: '400',
  caption: '400',
  metadata: '400',
};

export function Typography({
  variant = 'body',
  muted,
  children,
  style,
  ...rest
}: TextProps & { variant?: Variant; muted?: boolean }) {
  const { theme } = useSession();
  return (
    <Text
      {...rest}
      style={[
        {
          fontSize: sizes[variant],
          fontWeight: weights[variant],
          color: muted ? theme.muted : theme.text,
          lineHeight: sizes[variant] * 1.45,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

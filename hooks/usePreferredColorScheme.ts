import { useEffect, useState } from 'react';
import { Platform, useColorScheme } from 'react-native';
import type { ColorSchemeName } from '@/lib/theme';

export function usePreferredColorScheme(): ColorSchemeName {
  const native = useColorScheme();
  const [scheme, setScheme] = useState<ColorSchemeName>(native === 'dark' ? 'dark' : 'light');

  useEffect(() => {
    if (Platform.OS !== 'web') {
      setScheme(native === 'dark' ? 'dark' : 'light');
      return;
    }

    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      setScheme('light');
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setScheme(media.matches ? 'dark' : 'light');
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [native]);

  return scheme;
}

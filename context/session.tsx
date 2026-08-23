import { getLocales } from 'expo-localization';
import * as SplashScreen from 'expo-splash-screen';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import type { AuthStatus } from '@/lib/auth/routing';
import { supabase } from '@/lib/supabase';
import {
  resolveColorScheme,
  themeTokens,
  type ColorSchemePreference,
  type ThemeTokens,
  type VisualTheme,
} from '@/lib/theme';
import type { Profile } from '@/lib/types';
import { usePreferredColorScheme } from '@/hooks/usePreferredColorScheme';

void SplashScreen.preventAutoHideAsync();

interface SessionValue {
  session: Session | null;
  profile: Profile | null;
  theme: ThemeTokens;
  loading: boolean;
  status: AuthStatus;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (data) return data as Profile;
    await new Promise((resolve) => setTimeout(resolve, 160 * (attempt + 1)));
  }
  return null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const systemScheme = usePreferredColorScheme();

  const refreshProfile = useCallback(async (userId?: string) => {
    const id = userId ?? session?.user.id;
    if (!id) {
      setProfile(null);
      return;
    }
    setProfile(await fetchProfile(id));
  }, [session?.user.id]);

  useEffect(() => {
    let active = true;

    async function hydrate() {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (data.session) {
        setProfile(await fetchProfile(data.session.user.id));
      } else {
        setProfile(null);
      }
      if (active) {
        setProfileReady(true);
        setLoading(false);
      }
    }

    void hydrate();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'INITIAL_SESSION') return;
      setTimeout(() => {
        setSession(next);
        if (!next) {
          setProfile(null);
          setProfileReady(true);
          return;
        }
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const locale = getLocales()[0]?.languageTag ?? 'pt-BR';
          void supabase.from('profiles').update({ timezone, locale }).eq('id', next.user.id);
        }
        if (event === 'TOKEN_REFRESHED') return;
        setProfileReady(false);
        void fetchProfile(next.user.id).then((row) => {
          if (!active) return;
          setProfile(row);
          setProfileReady(true);
        });
      }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void supabase.auth.startAutoRefresh();
      else void supabase.auth.stopAutoRefresh();
    });
    void supabase.auth.startAutoRefresh();
    return () => subscription.remove();
  }, []);

  const status: AuthStatus =
    loading || (session !== null && !profileReady)
      ? 'loading'
      : session
        ? 'authenticated'
        : 'unauthenticated';

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  const value = useMemo<SessionValue>(
    () => ({
      session,
      profile,
      theme: themeTokens(
        profile?.visual_theme as VisualTheme,
        resolveColorScheme(profile?.color_scheme as ColorSchemePreference | undefined, systemScheme),
      ),
      loading,
      status,
      refreshProfile,
    }),
    [session, profile, loading, status, refreshProfile, systemScheme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession outside provider');
  return ctx;
}

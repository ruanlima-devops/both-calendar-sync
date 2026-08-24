import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { APP_SCHEME } from '@/lib/app';
import { AUTH_CALLBACK_PATH, createSessionFromUrl } from '@/lib/auth/callback';
import {
  isCancelledAuth,
  userMessageForAuthError,
  type GoogleAuthResult,
} from '@/lib/auth/errors';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

let inFlight = false;

export function getAuthRedirectUri(): string {
  return makeRedirectUri({
    scheme: APP_SCHEME,
    path: AUTH_CALLBACK_PATH,
  });
}

export async function signInWithGoogle(): Promise<GoogleAuthResult> {
  if (inFlight) return { status: 'busy' };
  inFlight = true;

  try {
    const redirectTo = getAuthRedirectUri();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: Platform.OS !== 'web',
        scopes: 'openid email profile',
        queryParams: {
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      if (isCancelledAuth(error)) return { status: 'cancelled' };
      return { status: 'error', message: userMessageForAuthError(error) };
    }

    if (Platform.OS === 'web') {
      return { status: 'redirecting' };
    }

    if (!data.url) {
      return { status: 'error', message: userMessageForAuthError(new Error('missing_oauth_url')) };
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
      showInRecents: true,
    });

    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { status: 'cancelled' };
    }

    if (result.type !== 'success' || !result.url) {
      return { status: 'cancelled' };
    }

    const outcome = await createSessionFromUrl(result.url);
    return outcome === 'success' ? { status: 'success' } : { status: 'cancelled' };
  } catch (error) {
    if (isCancelledAuth(error)) return { status: 'cancelled' };
    return { status: 'error', message: userMessageForAuthError(error) };
  } finally {
    inFlight = false;
  }
}

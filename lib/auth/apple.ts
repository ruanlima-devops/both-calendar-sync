import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { isCancelledAuth, userMessageForAuthError, type GoogleAuthResult } from '@/lib/auth/errors';

export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

function randomNonce(length = 32): string {
  const bytes = Crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, length);
}

export async function signInWithApple(): Promise<GoogleAuthResult> {
  if (Platform.OS !== 'ios') {
    return { status: 'error', message: 'Sign in with Apple está disponível apenas no iPhone.' };
  }

  try {
    const rawNonce = randomNonce();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      return { status: 'error', message: 'Apple não retornou um token de identidade.' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });

    if (error) {
      if (isCancelledAuth(error)) return { status: 'cancelled' };
      return { status: 'error', message: userMessageForAuthError(error) };
    }

    // Hide My Email / first login: persist display name when Apple sends it once.
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userId) {
        await supabase
          .from('profiles')
          .update({ display_name: fullName })
          .eq('id', userId)
          .is('display_name', null);
      }
    }

    return { status: 'success' };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_REQUEST_CANCELED' || isCancelledAuth(error)) {
      return { status: 'cancelled' };
    }
    return { status: 'error', message: userMessageForAuthError(error) };
  }
}

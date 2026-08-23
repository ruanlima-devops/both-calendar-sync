import { useCallback, useState } from 'react';
import { signInWithGoogle } from '@/lib/auth/google';

export function useGoogleAuth() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await signInWithGoogle();

    if (result.status === 'redirecting' || result.status === 'success') return;

    if (result.status === 'error') {
      setError(result.message);
      setBusy(false);
      return;
    }

    setBusy(false);
  }, [busy]);

  const clearError = useCallback(() => setError(null), []);

  return { signIn, busy, error, clearError };
}

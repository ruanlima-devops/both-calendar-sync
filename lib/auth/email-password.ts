/**
 * Both native email/password auth — thin wrappers around Supabase Auth only.
 * Never stores password hashes locally. Never logs credentials.
 */
import { getAuthRedirectUri } from '@/lib/auth/google';
import {
  AUTH_MESSAGES,
  classifyAuthError,
  userMessageForAuthError,
  userMessageForSignUpResult,
  type AuthErrorCategory,
} from '@/lib/auth/errors';
import {
  evaluatePassword,
  isValidEmailFormat,
  normalizeEmail,
  passwordsMatch,
} from '@/lib/auth/password-policy';
import { supabase } from '@/lib/supabase';

export type EmailAuthOutcome =
  | { status: 'success'; category?: undefined }
  | { status: 'confirm_email'; email: string }
  | { status: 'check_email'; email: string; kind: 'signup' | 'recovery' }
  | { status: 'validation'; message: string; category: 'VALIDATION' | 'WEAK_PASSWORD' }
  | { status: 'error'; message: string; category: AuthErrorCategory }
  | { status: 'busy' };

let signupInFlight = false;
let signInInFlight = false;
let resetInFlight = false;
let updateInFlight = false;
let resendInFlight = false;

const RESEND_COOLDOWN_MS = 60_000;
const lastResendByEmail = new Map<string, number>();

export function resendCooldownRemainingMs(email: string, now = Date.now()): number {
  const key = normalizeEmail(email);
  const last = lastResendByEmail.get(key);
  if (!last) return 0;
  return Math.max(0, RESEND_COOLDOWN_MS - (now - last));
}

function redirectTo(): string {
  return getAuthRedirectUri();
}

export async function signUpWithEmailPassword(input: {
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<EmailAuthOutcome> {
  if (signupInFlight) return { status: 'busy' };
  const email = normalizeEmail(input.email);
  if (!isValidEmailFormat(email)) {
    return { status: 'validation', message: 'Informe um e-mail válido.', category: 'VALIDATION' };
  }
  if (!passwordsMatch(input.password, input.confirmPassword)) {
    return {
      status: 'validation',
      message: 'As senhas não coincidem.',
      category: 'VALIDATION',
    };
  }
  const policy = evaluatePassword(input.password);
  if (!policy.ok) {
    return {
      status: 'validation',
      message: policy.message ?? AUTH_MESSAGES.weakPassword,
      category: 'WEAK_PASSWORD',
    };
  }

  signupInFlight = true;
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: {
        emailRedirectTo: redirectTo(),
      },
    });

    if (error) {
      const category = classifyAuthError(error);
      // Anti-enumeration: identity conflicts look like a successful "check email".
      if (category === 'IDENTITY_CONFLICT') {
        return { status: 'check_email', email, kind: 'signup' };
      }
      return {
        status: 'error',
        category,
        message: userMessageForSignUpResult(category),
      };
    }

    // Session only when project allows signup without confirm — still route carefully.
    if (data.session) {
      return { status: 'success' };
    }
    return { status: 'confirm_email', email };
  } catch (error) {
    const category = classifyAuthError(error);
    return {
      status: 'error',
      category,
      message: userMessageForAuthError(error, 'password'),
    };
  } finally {
    signupInFlight = false;
  }
}

export async function signInWithEmailPassword(input: {
  email: string;
  password: string;
}): Promise<EmailAuthOutcome> {
  if (signInInFlight) return { status: 'busy' };
  const email = normalizeEmail(input.email);
  if (!isValidEmailFormat(email) || !input.password) {
    return {
      status: 'validation',
      message: 'Informe e-mail e senha.',
      category: 'VALIDATION',
    };
  }

  signInInFlight = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: input.password,
    });
    if (error) {
      const category = classifyAuthError(error);
      return {
        status: 'error',
        category,
        message: userMessageForAuthError(error, 'password'),
      };
    }
    return { status: 'success' };
  } catch (error) {
    const category = classifyAuthError(error);
    return {
      status: 'error',
      category,
      message: userMessageForAuthError(error, 'password'),
    };
  } finally {
    signInInFlight = false;
  }
}

export async function requestPasswordReset(emailRaw: string): Promise<EmailAuthOutcome> {
  if (resetInFlight) return { status: 'busy' };
  const email = normalizeEmail(emailRaw);
  if (!isValidEmailFormat(email)) {
    return { status: 'validation', message: 'Informe um e-mail válido.', category: 'VALIDATION' };
  }

  resetInFlight = true;
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo(),
    });
    // Always return check_email to reduce enumeration (except rate limit / network).
    if (error) {
      const category = classifyAuthError(error);
      if (category === 'RATE_LIMITED' || category === 'NETWORK') {
        return {
          status: 'error',
          category,
          message: userMessageForAuthError(error, 'password'),
        };
      }
    }
    return { status: 'check_email', email, kind: 'recovery' };
  } catch (error) {
    const category = classifyAuthError(error);
    if (category === 'RATE_LIMITED' || category === 'NETWORK') {
      return {
        status: 'error',
        category,
        message: userMessageForAuthError(error, 'password'),
      };
    }
    return { status: 'check_email', email, kind: 'recovery' };
  } finally {
    resetInFlight = false;
  }
}

export async function updatePasswordAuthenticated(input: {
  password: string;
  confirmPassword: string;
}): Promise<EmailAuthOutcome> {
  if (updateInFlight) return { status: 'busy' };
  if (!passwordsMatch(input.password, input.confirmPassword)) {
    return {
      status: 'validation',
      message: 'As senhas não coincidem.',
      category: 'VALIDATION',
    };
  }
  const policy = evaluatePassword(input.password);
  if (!policy.ok) {
    return {
      status: 'validation',
      message: policy.message ?? AUTH_MESSAGES.weakPassword,
      category: 'WEAK_PASSWORD',
    };
  }

  updateInFlight = true;
  try {
    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) {
      const category = classifyAuthError(error);
      return {
        status: 'error',
        category,
        message: userMessageForAuthError(error, 'password'),
      };
    }
    return { status: 'success' };
  } catch (error) {
    const category = classifyAuthError(error);
    return {
      status: 'error',
      category,
      message: userMessageForAuthError(error, 'password'),
    };
  } finally {
    updateInFlight = false;
  }
}

export async function resendSignupConfirmation(emailRaw: string): Promise<EmailAuthOutcome> {
  if (resendInFlight) return { status: 'busy' };
  const email = normalizeEmail(emailRaw);
  if (!isValidEmailFormat(email)) {
    return { status: 'validation', message: 'Informe um e-mail válido.', category: 'VALIDATION' };
  }
  const remaining = resendCooldownRemainingMs(email);
  if (remaining > 0) {
    return {
      status: 'error',
      category: 'RATE_LIMITED',
      message: `Aguarde ${Math.ceil(remaining / 1000)}s para reenviar.`,
    };
  }

  resendInFlight = true;
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    lastResendByEmail.set(email, Date.now());
    if (error) {
      const category = classifyAuthError(error);
      if (category === 'RATE_LIMITED' || category === 'NETWORK') {
        return {
          status: 'error',
          category,
          message: userMessageForAuthError(error, 'password'),
        };
      }
    }
    return { status: 'check_email', email, kind: 'signup' };
  } catch (error) {
    lastResendByEmail.set(email, Date.now());
    const category = classifyAuthError(error);
    if (category === 'RATE_LIMITED' || category === 'NETWORK') {
      return {
        status: 'error',
        category,
        message: userMessageForAuthError(error, 'password'),
      };
    }
    return { status: 'check_email', email, kind: 'signup' };
  } finally {
    resendInFlight = false;
  }
}

export async function signOutBoth(): Promise<EmailAuthOutcome> {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) {
      return {
        status: 'error',
        category: classifyAuthError(error),
        message: userMessageForAuthError(error, 'password'),
      };
    }
    return { status: 'success' };
  } catch (error) {
    return {
      status: 'error',
      category: classifyAuthError(error),
      message: userMessageForAuthError(error, 'password'),
    };
  }
}

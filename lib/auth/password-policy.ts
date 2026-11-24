/**
 * Client-side password policy for Both native email/password auth.
 * Supabase Auth remains the only store for password hashes.
 */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRequirementId = 'length' | 'letter' | 'number';

export type PasswordRequirement = {
  id: PasswordRequirementId;
  label: string;
  met: boolean;
};

export type PasswordPolicyResult = {
  ok: boolean;
  requirements: PasswordRequirement[];
  message: string | null;
};

export function evaluatePassword(password: string): PasswordPolicyResult {
  const value = password ?? '';
  const requirements: PasswordRequirement[] = [
    {
      id: 'length',
      label: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
      met: value.length >= PASSWORD_MIN_LENGTH,
    },
    {
      id: 'letter',
      label: 'Pelo menos uma letra',
      met: /[A-Za-zÀ-ÿ]/.test(value),
    },
    {
      id: 'number',
      label: 'Pelo menos um número',
      met: /\d/.test(value),
    },
  ];
  const ok = requirements.every((r) => r.met);
  return {
    ok,
    requirements,
    message: ok ? null : 'A senha não atende aos requisitos de segurança.',
  };
}

export function passwordsMatch(password: string, confirm: string): boolean {
  return password.length > 0 && password === confirm;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

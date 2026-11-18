/** Sanitize strings for logs / issue bodies — no secrets/PII. */

const SECRETISH =
  /(bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|sbp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+)/gi;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactText(input: string, max = 500): string {
  let out = String(input ?? '');
  out = out.replace(SECRETISH, '[redacted]');
  out = out.replace(EMAIL, '[email]');
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return redactText(err.message, 200);
  return redactText(String(err), 200);
}

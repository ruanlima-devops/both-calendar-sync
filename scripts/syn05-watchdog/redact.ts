/** Sanitize strings for logs / issue bodies — no secrets/PII. Deterministic, best-effort. */

const SECRETISH =
  /(authorization\s*[:=]\s*bearer\s+\S+|authorization\s+bearer\s+\S+|bearer\s+\S+|authorization\s*[:=]\s*\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?|sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|sbp_(?:fc_)?[A-Za-z0-9]+|sb_secret_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|xox[baprs]-[A-Za-z0-9-]+)/gi;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** password / token / api_key style assignments and query params */
const CRED_ASSIGN =
  /((?:password|passwd|pwd|pass|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|client_secret|authorization)\s*[=:]\s*)([^\s&;"']+)/gi;

const QUERY_SECRET =
  /([?&](?:password|passwd|pwd|pass|secret|token|access_token|refresh_token|api_key|apikey|client_secret|key|auth)=)([^&\s#]+)/gi;

const COOKIE =
  /((?:set-)?cookie\s*[:=]\s*)([^\r\n;]+)/gi;

/** user:password@ in URLs */
const URL_USERINFO = /(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

const DEFAULT_EVENT_MESSAGE_MAX = 800;

export function redactText(input: string, max = 500): string {
  let out = String(input ?? '');
  out = out.replace(SECRETISH, '[redacted]');
  out = out.replace(URL_USERINFO, '$1[redacted]:[redacted]@');
  out = out.replace(CRED_ASSIGN, '$1[redacted]');
  out = out.replace(QUERY_SECRET, '$1[redacted]');
  out = out.replace(COOKIE, '$1[redacted]');
  out = out.replace(EMAIL, '[email]');
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

/**
 * Sanitize a logs API event_message before any consumer sees it.
 * Best-effort — free-text cannot be proven perfect; prefer discarding excess.
 */
export function sanitizeLogEventMessage(
  input: unknown,
  max = DEFAULT_EVENT_MESSAGE_MAX,
): string {
  try {
    if (input == null) return '';
    const raw = typeof input === 'string' ? input : String(input);
    if (!raw) return '';
    const once = redactText(raw, max);
    // Idempotent second pass (patterns must not reintroduce secrets)
    return redactText(once, max);
  } catch {
    return '[redacted_unparseable]';
  }
}

export function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return redactText(err.message, 200);
  return redactText(String(err), 200);
}

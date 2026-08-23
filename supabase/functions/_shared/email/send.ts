import { env, envOptional } from '../http.ts';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(message: OutboundEmail): Promise<{ id?: string; skipped?: boolean }> {
  const apiKey = envOptional('RESEND_API_KEY');
  if (!apiKey) {
    console.log(JSON.stringify({ message: 'email_skipped_no_provider', to_domain: message.to.split('@')[1] }));
    return { skipped: true };
  }

  const from = envOptional('RESEND_FROM_EMAIL') ?? 'Both <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { message?: string }).message ?? `resend_${res.status}`);
  }
  return { id: (body as { id?: string }).id };
}

export function appBaseUrl(): string {
  return (envOptional('APP_URL') ?? 'https://unify.app').replace(/\/$/, '');
}

export function accountPreferencesUrl(): string {
  return `${appBaseUrl()}/settings`;
}

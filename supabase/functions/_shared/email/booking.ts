/** Booking confirmation emails (Resend). */

import { appBaseUrl } from './send.ts';

export function bookingConfirmationEmail(input: {
  guestName: string;
  guestEmail: string;
  hostName: string;
  meetingTitle: string;
  startAt: string;
  endAt: string;
  timezone: string;
  manageToken: string;
}): { subject: string; html: string; text: string } {
  const when = formatRange(input.startAt, input.endAt, input.timezone);
  const manageUrl = `${appBaseUrl()}/book/manage/${input.manageToken}`;
  const subject = `Confirmado: ${input.meetingTitle} com ${input.hostName}`;
  const text = [
    `Olá ${input.guestName},`,
    '',
    `Seu agendamento está confirmado.`,
    '',
    input.meetingTitle,
    `Com: ${input.hostName}`,
    when,
    '',
    `Um convite de calendário foi enviado para ${input.guestEmail}.`,
    '',
    `Cancelar ou reagendar: ${manageUrl}`,
    '',
    '— Both',
  ].join('\n');

  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#0f172a;line-height:1.5;padding:24px;">
  <p style="letter-spacing:4px;font-weight:700;font-size:12px;color:#64748b;">BOTH</p>
  <h1 style="font-size:22px;margin:16px 0 8px;">Agendamento confirmado</h1>
  <p style="margin:0 0 20px;color:#64748b;">Olá ${escapeHtml(input.guestName)},</p>
  <div style="padding:16px 18px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
    <p style="margin:0 0 6px;font-weight:600;">${escapeHtml(input.meetingTitle)}</p>
    <p style="margin:0 0 6px;">Com ${escapeHtml(input.hostName)}</p>
    <p style="margin:0;color:#334155;">${escapeHtml(when)}</p>
  </div>
  <p style="margin:20px 0 8px;">Um convite foi enviado para <strong>${escapeHtml(input.guestEmail)}</strong>.</p>
  <p style="margin:24px 0;"><a href="${manageUrl}" style="color:#2563eb;">Cancelar ou reagendar</a></p>
  <p style="color:#94a3b8;font-size:13px;">— Both</p>
</body></html>`;

  return { subject, html, text };
}

function formatRange(startAt: string, endAt: string, timeZone: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(start);
  const t0 = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(start);
  const t1 = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(end);
  return `${day}, ${t0}–${t1} (${timeZone})`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

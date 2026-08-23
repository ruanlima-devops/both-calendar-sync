import type { DigestEvent, DigestPeriod } from './digest.ts';
import {
  dayHeading,
  formatDuration,
  formatEventTime,
  groupEventsByDay,
  totalScheduledMinutes,
} from './digest.ts';

export interface DigestTemplateInput {
  period: DigestPeriod;
  events: DigestEvent[];
  timezone: string;
  displayName: string | null;
  appUrl: string;
  activeCalendars: number;
  preferencesUrl: string;
}

export function digestSubject(input: DigestTemplateInput): string {
  const who = input.displayName ? `${input.displayName}, ` : '';
  if (input.period.type === 'weekly') {
    return `${who}sua semana no Both (${input.period.titleLabel})`;
  }
  return `${who}seu mês no Both (${input.period.titleLabel})`;
}

export function digestText(input: DigestTemplateInput): string {
  const lines: string[] = [];
  const heading = input.period.type === 'weekly' ? 'Sua semana no Both' : 'Seu mês no Both';
  lines.push(heading, input.period.titleLabel, '');
  if (input.events.length === 0) {
    lines.push(
      input.period.type === 'weekly'
        ? 'Sua semana está livre — nenhum compromisso programado.'
        : 'Seu mês passado não teve compromissos registrados no Both.',
      '',
      `Abrir Both: ${input.appUrl}`,
      `Preferências de email: ${input.preferencesUrl}`,
    );
    return lines.join('\n');
  }

  const total = input.events.length;
  const duration = formatDuration(totalScheduledMinutes(input.events));
  lines.push(`${total} compromissos`, `${duration} reservadas`, `${input.activeCalendars} agendas ativas`, '');

  for (const [day, dayEvents] of groupEventsByDay(input.events, input.timezone)) {
    lines.push(dayHeading(day, input.timezone));
    for (const event of dayEvents) {
      lines.push(`${formatEventTime(event, input.timezone)}  ${event.title}`);
    }
    lines.push('');
  }

  lines.push(`Abrir Both: ${input.appUrl}`, `Gerenciar emails: ${input.preferencesUrl}`);
  return lines.join('\n');
}

export function digestHtml(input: DigestTemplateInput): string {
  const heading = input.period.type === 'weekly' ? 'Sua semana no Both' : 'Seu mês no Both';
  const emptyCopy = input.period.type === 'weekly'
    ? 'Sua semana está livre — nenhum compromisso programado.'
    : 'Seu mês passado não teve compromissos registrados no Both.';

  const stats = input.events.length === 0
    ? `<p style="margin:0;color:#64748b;font-size:15px;line-height:1.6;">${emptyCopy}</p>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 24px;border-collapse:collapse;">
        <tr>
          <td style="padding:12px 16px;background:#f8fafc;border-radius:12px;font-size:14px;color:#0f172a;"><strong>${input.events.length}</strong><br><span style="color:#64748b;">compromissos</span></td>
          <td style="width:8px"></td>
          <td style="padding:12px 16px;background:#f8fafc;border-radius:12px;font-size:14px;color:#0f172a;"><strong>${formatDuration(totalScheduledMinutes(input.events))}</strong><br><span style="color:#64748b;">reservadas</span></td>
          <td style="width:8px"></td>
          <td style="padding:12px 16px;background:#f8fafc;border-radius:12px;font-size:14px;color:#0f172a;"><strong>${input.activeCalendars}</strong><br><span style="color:#64748b;">agendas</span></td>
        </tr>
      </table>`;

  let body = '';
  if (input.events.length > 0) {
    for (const [day, dayEvents] of groupEventsByDay(input.events, input.timezone)) {
      body += `<h3 style="margin:24px 0 8px;font-size:12px;letter-spacing:0.08em;color:#64748b;">${dayHeading(day, input.timezone)}</h3>`;
      for (const event of dayEvents) {
        body += `<div style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:13px;color:#64748b;">${formatEventTime(event, input.timezone)}</div>
          <div style="font-size:15px;color:#0f172a;font-weight:600;margin-top:2px;">${escapeHtml(event.title)}</div>
        </div>`;
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
      <tr><td style="padding:32px 28px;">
        <div style="font-size:13px;font-weight:700;color:#2563eb;letter-spacing:0.04em;">BOTH</div>
        <h1 style="margin:12px 0 4px;font-size:24px;color:#0f172a;">${heading}</h1>
        <p style="margin:0 0 20px;color:#64748b;font-size:15px;">${escapeHtml(input.period.titleLabel)}</p>
        ${stats}
        ${body}
        <p style="margin:28px 0 16px;">
          <a href="${escapeHtml(input.appUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:15px;">Abrir Both</a>
        </p>
        <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
          <a href="${escapeHtml(input.preferencesUrl)}" style="color:#64748b;">Gerenciar preferências de email</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

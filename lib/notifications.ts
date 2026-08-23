import { differenceInMinutes, parseISO } from 'date-fns';
import { addDay, dayKey, todayKey } from '@/lib/dates';
import type { ProviderName } from '@/lib/types';

export type NotificationType =
  | 'calendar_event_created'
  | 'calendar_event_updated'
  | 'calendar_event_deleted';

export type NotificationMetadata = {
  providerEventId?: string;
  startAt?: string;
  allDay?: boolean;
  changes?: string[];
};

export type AppNotification = {
  id: string;
  user_id: string;
  type: NotificationType | string;
  provider: ProviderName | 'UNIFY' | null;
  connection_id: string | null;
  entity_type: string;
  entity_id: string | null;
  title: string;
  body: string;
  metadata: NotificationMetadata;
  dedupe_key: string;
  read_at: string | null;
  created_at: string;
};

export const NOTIFICATION_PAGE_SIZE = 30;

export function providerLabel(provider: ProviderName | 'UNIFY' | null): string {
  if (provider === 'GOOGLE') return 'Google';
  if (provider === 'MICROSOFT') return 'Microsoft';
  if (provider === 'ICLOUD') return 'Apple iCloud';
  if (provider === 'UNIFY') return 'Both';
  return 'Both';
}

export function unreadBadgeLabel(count: number): string | null {
  if (count <= 0) return null;
  if (count > 9) return '9+';
  return String(count);
}

export function notificationsA11yLabel(count: number): string {
  if (count <= 0) return 'Notificações';
  if (count === 1) return 'Notificações, 1 não lida';
  return `Notificações, ${count} não lidas`;
}

export function relativeTime(iso: string, now = new Date()): string {
  const then = parseISO(iso);
  const minutes = Math.max(0, differenceInMinutes(now, then));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'há 1 h' : `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `há ${days} dias`;
  return then.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}

export type NotificationGroup = { label: string; items: AppNotification[] };

export function groupNotifications(items: AppNotification[], timeZone: string): NotificationGroup[] {
  const today = todayKey(timeZone);
  const yesterday = addDay(today, -1);
  const weekStart = addDay(today, -6);
  const buckets: Record<string, AppNotification[]> = {
    Hoje: [],
    Ontem: [],
    'Esta semana': [],
    Anteriores: [],
  };
  for (const item of items) {
    const day = dayKey(item.created_at, timeZone);
    if (day === today) buckets.Hoje.push(item);
    else if (day === yesterday) buckets.Ontem.push(item);
    else if (day >= weekStart) buckets['Esta semana'].push(item);
    else buckets.Anteriores.push(item);
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, items: list }));
}

export function notificationPreview(item: AppNotification): { headline: string; detail: string } {
  const [headline, ...rest] = item.body.split('\n');
  return { headline: headline || item.title, detail: rest.join(' ').trim() };
}

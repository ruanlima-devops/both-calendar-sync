export type CalendarNotifyKind = 'created' | 'updated' | 'deleted';

export type VisibleChange = 'title' | 'time' | 'date' | 'location';

export type EventSnapshot = {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location?: string | null;
  eventRole?: string;
};

export type CalendarNotificationDraft = {
  kind: CalendarNotifyKind;
  type: 'calendar_event_created' | 'calendar_event_updated' | 'calendar_event_deleted';
  title: string;
  body: string;
  changes: VisibleChange[];
};

function datePart(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function timePart(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function whenLabel(iso: string, allDay: boolean, timeZone: string): string {
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
  if (allDay) return day;
  return `${day} · ${timePart(iso, timeZone)}`;
}

export function notificationDraftForSync(
  syncMode: 'full' | 'incremental',
  previous: EventSnapshot | null,
  incoming: EventSnapshot,
  timeZone: string,
  isDeleted = false,
  provider?: string,
): CalendarNotificationDraft | null {
  if (syncMode !== 'incremental') return null;
  return describeCalendarChange(previous, incoming, timeZone, isDeleted, provider);
}

function providerAgenda(provider?: string): string {
  if (provider === 'GOOGLE') return 'Google Calendar';
  if (provider === 'MICROSOFT') return 'Microsoft';
  if (provider === 'ICLOUD') return 'Apple iCloud';
  return 'calendário';
}

export function describeCalendarChange(
  previous: EventSnapshot | null,
  incoming: EventSnapshot,
  timeZone: string,
  isDeleted = false,
  provider?: string,
): CalendarNotificationDraft | null {
  const role = previous?.eventRole ?? incoming.eventRole;
  if (role === 'ORIGIN' || role === 'MIRROR') return null;

  const incomingDeleted = isDeleted;
  const title = incoming.title || previous?.title || '(sem título)';

  if (incomingDeleted) {
    if (!previous) return null;
    return {
      kind: 'deleted',
      type: 'calendar_event_deleted',
      title: 'Evento cancelado',
      body: `${previous.title || title}\nO evento foi removido do ${providerAgenda(provider)}.`,
      changes: [],
    };
  }

  if (!previous) {
    return {
      kind: 'created',
      type: 'calendar_event_created',
      title: 'Novo evento',
      body: `${title}\n${whenLabel(incoming.startAt, incoming.allDay, timeZone)}`,
      changes: [],
    };
  }

  const changes: VisibleChange[] = [];
  if (previous.title !== incoming.title) changes.push('title');
  if (previous.allDay !== incoming.allDay || previous.startAt !== incoming.startAt || previous.endAt !== incoming.endAt) {
    const dateChanged = datePart(previous.startAt, timeZone) !== datePart(incoming.startAt, timeZone);
    const timeChanged = previous.allDay !== incoming.allDay
      || timePart(previous.startAt, timeZone) !== timePart(incoming.startAt, timeZone)
      || timePart(previous.endAt, timeZone) !== timePart(incoming.endAt, timeZone);
    if (dateChanged) changes.push('date');
    else if (timeChanged) changes.push('time');
  }
  if ((previous.location ?? '') !== (incoming.location ?? '')) changes.push('location');
  if (changes.length === 0) return null;

  const lines = [incoming.title || previous.title];
  if (changes.length > 1) {
    const labels = changes.map((change) => (
      change === 'title' ? 'nome' : change === 'time' ? 'horário' : change === 'date' ? 'data' : 'local'
    ));
    const last = labels.pop();
    lines.push(`${labels.join(', ')} e ${last} foram alterados.`);
  } else if (changes[0] === 'title') {
    lines.push(`"${previous.title}" agora se chama "${incoming.title}".`);
  } else if (changes[0] === 'time') {
    if (incoming.allDay) lines.push('O evento passou a ser o dia inteiro.');
    else lines.push(`Horário alterado de ${timePart(previous.startAt, timeZone)} para ${timePart(incoming.startAt, timeZone)}.`);
  } else if (changes[0] === 'date') {
    lines.push(`Movido para ${whenLabel(incoming.startAt, incoming.allDay, timeZone)}.`);
  } else if (changes[0] === 'location') {
    lines.push(incoming.location ? `Agora será em ${incoming.location}.` : 'O local do evento foi removido.');
  }

  return {
    kind: 'updated',
    type: 'calendar_event_updated',
    title: changes[0] === 'date' && changes.length === 1 ? 'Evento reagendado' : 'Evento atualizado',
    body: lines.join('\n'),
    changes,
  };
}

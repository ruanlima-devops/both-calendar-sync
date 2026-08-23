export function isWritableAccessRole(role: string | null | undefined): boolean {
  const value = String(role ?? '').toLowerCase();
  return value === 'owner' || value === 'writer' || value === 'editor';
}

/** Google-safe event id from a UUID (a-v + digits). */
export function toGoogleEventId(uuid: string): string {
  return uuid.toLowerCase().replace(/[^a-v0-9]/g, '').padEnd(26, '0').slice(0, 26);
}

export function validateCreateEventForm(input: {
  title: string;
  date: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
}): string | null {
  if (!input.title.trim()) return 'Informe um título.';
  if (!input.calendarId) return 'Escolha um calendário.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return 'Data inválida.';
  if (!input.allDay) {
    if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end)) {
      return 'Horário inválido.';
    }
    if (input.end <= input.start) return 'O horário final deve ser depois do início.';
  }
  return null;
}

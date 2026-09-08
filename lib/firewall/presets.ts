/** Client-side Calendar Firewall presets — keep aligned with Edge shared rules. */

export type FirewallPrivacyPreset = 'availability' | 'limited' | 'full' | 'custom';

export interface FirewallRuleRow {
  id: string;
  user_id: string;
  source_calendar_id: string;
  destination_calendar_id: string;
  enabled: boolean;
  privacy_preset: FirewallPrivacyPreset;
  sync_title: boolean;
  sync_description: boolean;
  sync_location: boolean;
  sync_attendees: boolean;
  sync_conference: boolean;
  ignore_free: boolean;
  ignore_cancelled: boolean;
  placeholder_title: string;
  busy_status: string;
  health_status: string;
  last_processed_at: string | null;
  last_error: string | null;
}

export const FIREWALL_PRESETS: Array<{
  id: FirewallPrivacyPreset;
  label: string;
  description: string;
  flags: {
    sync_title: boolean;
    sync_description: boolean;
    sync_location: boolean;
    sync_attendees: boolean;
    sync_conference: boolean;
  };
}> = [
  {
    id: 'availability',
    label: 'Apenas disponibilidade',
    description: 'O destino vê só “Horário reservado · Both”. Detalhes permanecem privados.',
    flags: {
      sync_title: false,
      sync_description: false,
      sync_location: false,
      sync_attendees: false,
      sync_conference: false,
    },
  },
  {
    id: 'limited',
    label: 'Detalhes limitados',
    description: 'Compartilha título e local. Descrição, participantes e videoconferência ficam ocultos.',
    flags: {
      sync_title: true,
      sync_description: false,
      sync_location: true,
      sync_attendees: false,
      sync_conference: false,
    },
  },
  {
    id: 'full',
    label: 'Detalhes completos',
    description: 'Compartilha título, descrição e local. Participantes e Meet/Teams nunca são convidados automaticamente.',
    flags: {
      sync_title: true,
      sync_description: true,
      sync_location: true,
      sync_attendees: false,
      sync_conference: false,
    },
  },
];

export function detectPreset(flags: {
  sync_title: boolean;
  sync_description: boolean;
  sync_location: boolean;
}): FirewallPrivacyPreset {
  const match = FIREWALL_PRESETS.find(
    (p) =>
      p.id !== 'custom' &&
      p.flags.sync_title === flags.sync_title &&
      p.flags.sync_description === flags.sync_description &&
      p.flags.sync_location === flags.sync_location,
  );
  return match?.id ?? 'custom';
}

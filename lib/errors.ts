const FRIENDLY: Record<string, string> = {
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente.',
  connection_not_found: 'Conexão de calendário não encontrada.',
  secrets_not_found: 'Não foi possível acessar as credenciais do calendário. Reconecte a conta.',
  token_exchange_failed: 'Não foi possível concluir a autorização. Tente conectar novamente.',
  invalid_state: 'A autorização expirou. Tente conectar novamente.',
  missing_refresh_token: 'Permissão incompleta. Reconecte e aceite todas as permissões.',
  calendar_required: 'Escolha um calendário.',
  title_required: 'Informe um título.',
  time_required: 'Informe data e horário válidos.',
  end_before_start: 'O horário final deve ser depois do início.',
  calendar_read_only: 'Este calendário é somente leitura.',
  calendar_not_found: 'Calendário não encontrado.',
  ENTITLEMENT_REQUIRED: 'Assine o Both Pro para usar esta funcionalidade.',
  SLOT_UNAVAILABLE: 'Este horário acabou de ficar indisponível. Escolha outro horário.',
  link_disabled: 'Este link de agendamento está desativado.',
  link_expired: 'Este link de agendamento expirou.',
  link_not_found: 'Link de agendamento não encontrado.',
  username_taken: 'Este username já está em uso.',
  slug_taken: 'Este slug já está em uso.',
  invalid_username: 'Username inválido.',
  invalid_slug: 'Slug inválido.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um momento e tente de novo.',
  icloud_auth_failed:
    'Não foi possível conectar sua conta iCloud. Confira o email e a senha específica de app e tente novamente.',
  icloud_email_required: 'Informe o email da Conta Apple.',
  icloud_password_required: 'Informe a senha específica de app.',
  icloud_connect_failed: 'Não foi possível conectar o iCloud Calendar. Tente novamente.',
  icloud_timeout: 'A conexão com o iCloud demorou demais. Tente novamente.',
  icloud_no_calendars: 'Nenhum calendário foi encontrado nesta Conta Apple.',
  icloud_etag_conflict: 'O evento foi alterado em outro lugar. Atualize e tente de novo.',
  STRIPE_NOT_CONFIGURED: 'Pagamentos ainda não configurados.',
  ALREADY_SUBSCRIBED: 'Você já possui uma assinatura ativa.',
  MIRROR_MANAGED:
    'Este horário é gerenciado automaticamente. Edite o compromisso original para alterar a reserva.',
  CALENDAR_READ_ONLY: 'Este calendário é somente leitura.',
  PROVIDER_DELETE_FAILED: 'Não foi possível excluir o evento. Tente novamente.',
  EVENT_CONNECTION_MISSING: 'Não foi possível localizar a conexão deste evento. Sincronize e tente de novo.',
};

export function friendlyError(raw: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  const message = raw instanceof Error ? raw.message : String(raw ?? '');
  if (!message) return fallback;
  for (const [key, label] of Object.entries(FRIENDLY)) {
    if (message.includes(key)) return label;
  }
  if (/PostgrestError|AuthApiError|FunctionsHttpError|GraphError|GoogleApiError/i.test(message)) {
    return fallback;
  }
  if (message.length > 120) return fallback;
  return message;
}

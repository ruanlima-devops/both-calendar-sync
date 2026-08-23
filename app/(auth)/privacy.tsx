import { LegalDocument } from '@/components/auth/LegalDocument';

const BODY = `Última atualização: 23 de agosto de 2026

[REVISÃO JURÍDICA NECESSÁRIA] Este texto é um rascunho técnico para publicação nas lojas. Faça revisão por advogado antes de usar como política definitiva.

1. Quem somos
O Unify é um aplicativo de calendário unificado que sincroniza agendas Google, Microsoft e Apple iCloud que você conectar.

2. Dados que tratamos
• Conta: identificador de usuário, e-mail (ou e-mail oculto da Apple), nome de exibição opcional, fuso horário e preferências.
• Autenticação: via Supabase Auth (Google e, no iOS, Sign in with Apple).
• Calendários: metadados das agendas conectadas e eventos sincronizados que você autorizar (título, horários, local, descrição, status), armazenados no Supabase para exibição unificada.
• Tokens de calendário: access/refresh tokens (Google/Microsoft) e senha específica de app do iCloud, criptografados no backend com TOKEN_ENCRYPTION_KEY; não são armazenados no aplicativo mobile. Sign in with Apple (login) é separado do acesso ao iCloud Calendar.
• Notificações in-app e preferências de e-mail (resumos semanais/mensais).
• Assinatura: status de trial/assinatura, provedor (Stripe, App Store ou Google Play) e identificadores de cobrança necessários.

3. Finalidades
Autenticar você, sincronizar calendários, evitar conflitos entre agendas, enviar resumos opcionais, processar assinatura Unify Pro e melhorar confiabilidade do produto.

4. Terceiros
Supabase (backend/auth/banco), Google (login e Calendar), Microsoft (Graph), Apple iCloud Calendar via CalDAV (senha específica de app), Stripe (cobrança web), Apple/Google Play/RevenueCat (cobrança mobile), Resend (e-mails).

5. Retenção e exclusão
Você pode excluir a conta no app (Conta → Excluir minha conta) ou em /delete-account. Isso remove perfil, conexões, tokens de calendário, eventos sincronizados e preferências. Registros financeiros mínimos podem ser retidos conforme obrigação legal.

6. Tracking
O Unify não utiliza SDKs de publicidade para tracking cross-app. Não revendemos seus eventos de calendário.

7. Contato
[PENDENTE] Informe e-mail/URL de suporte oficiais antes da publicação.

Se houver domínio público, hospede também esta política em URL estável exigida pelas lojas.`;

export default function PrivacyScreen() {
  return <LegalDocument title="Política de Privacidade" body={BODY} />;
}

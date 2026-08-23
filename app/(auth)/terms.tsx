import { LegalDocument } from '@/components/auth/LegalDocument';

const BODY = `Última atualização: 23 de agosto de 2026

[REVISÃO JURÍDICA NECESSÁRIA] Rascunho técnico — revise com assessoria jurídica antes da publicação.

1. Aceite
Ao usar o Unify, você concorda com estes Termos.

2. Serviço
O Unify sincroniza calendários Google e/ou Microsoft que você conectar e oferece recursos de organização, notificações in-app e resumos por e-mail, conforme seu plano (teste gratuito ou Unify Pro).

3. Conta
Você é responsável pelas contas Google/Microsoft/Apple vinculadas e pelas permissões concedidas.

4. Assinaturas
• Web: cobrança via Stripe.
• iOS: assinatura via App Store.
• Android: assinatura via Google Play.
O acesso Unify Pro é gerenciado pelo nosso backend de entitlement. Cancelamentos e reembolsos seguem as regras da loja ou do Stripe, conforme a origem da compra.

5. Uso aceitável
Não utilize o serviço para atividades ilegais, abuso de APIs de terceiros ou tentativa de contornar limites de assinatura.

6. Disponibilidade
Sincronização depende de APIs Google/Microsoft e da disponibilidade da internet. Não garantimos disponibilidade ininterrupta.

7. Limitação
[PENDENTE — revisão jurídica] Inclua cláusulas de limitação de responsabilidade adequadas à sua jurisdição.

8. Contato
[PENDENTE] E-mail/URL de suporte.`;

export default function TermsScreen() {
  return <LegalDocument title="Termos de Uso" body={BODY} />;
}

# ERP Flow — segunda etapa de autorização

## Resultado

As dez funções desta etapa foram corrigidas e implantadas. O bloqueio permanece **desligado**, `enabled=false`, `coverage_verified=false`, versão 2, confirmado por leitura independente em 18/11/2026. Nenhum perfil, papel, empresa acessível, credencial, matriz ou agendamento foi alterado.

## Arquivos alterados

- `supabase/functions/_shared/resource-access.ts`: autorização de empresa persistida, ação existente e responsável/aliases verificados; validação de UUID.
- `supabase/functions/_shared/pagcorp-receipt-url.ts`: confinamento de URLs de recibos à origem HTTPS e ao caminho da API configurada.
- `supabase/functions/advance-to-sap/index.ts`: empresa/responsável, aprovação, retry técnico autenticado e ausência de efeitos ao negar acesso.
- `supabase/functions/expense-to-sap/index.ts`: empresa/responsável/ação antes de integração ou alteração; negativas não persistem status, notificações, retentativas ou liberação de lock; empresa do log vem do documento.
- `supabase/functions/advance-reconcile/index.ts`: sessão SAP da mesma empresa e permissão de criação em vendas, módulo usado pelo fluxo de adiantamentos de cliente.
- `supabase/functions/sales-nfse-emit/index.ts`: cancelamento exige `sales/delete`; emissão e consultas validam empresa e permissões correspondentes.
- `supabase/functions/pagcorp-settlement-watcher/index.ts`: baixa manual exige `pagcorp/integrate` da empresa do log antes de limpar tentativas ou adquirir lock; cookie SAP só é reutilizado após validação da sessão.
- `supabase/functions/pagcorp-card-mapping/index.ts`: preflight de todas as empresas do lote; deletes obtêm empresa do registro; IDs não podem mover registros entre empresas; inserção/edição/exclusão exigem ações correspondentes. Catalogação observacional de cartões mantém `view`.
- `supabase/functions/pagcorp-proxy/index.ts`: empresa/módulo antes das credenciais; URLs diretas, links JSON e redirects não podem levar o bearer para fora da API confiável.
- `supabase/functions/cashflow-forecast/index.ts`: permissão `financial_review/view` da empresa solicitada.
- `supabase/functions/nf-entrada-erp-status/index.ts`: empresa da nota validada antes de consulta/sincronização, inclusive quando só há import_id.
- `supabase/functions/expense-backfill-due-date/index.ts`: responsável/empresa antes dos anexos e IA; administração usa guard compartilhado, sem depender só do mapeamento SAP; batch SAP exige empresa explícita.
- `src/lib/erp-resource-access.test.ts`: execução dos handlers reais com dependências sintéticas e verificação de ausência de efeitos indevidos.
- `AGENTS.md`, `roadmap.md` e este relatório.

## Testes executados

- `bunx vitest run src/lib/erp-resource-access.test.ts src/lib/erp-access.test.ts src/lib/automation-auth.test.ts`: **47 testes aprovados**.
- 37 testes novos: empresas indevidas nos dez handlers, falta de papel/ação na mesma empresa, responsabilidade indevida, criação sem permissão, lote multiempresa antes de qualquer escrita, confinamento de URLs; cenários autorizados de Mauricio, Juliana e Artur com perfis sintéticos equivalentes, leitura de integração já existente, integração pendente sem escrita SAP e listagem de mapeamentos.
- `deno check --no-config` dos dois novos helpers: aprovado.
- Verificação ampla Deno dos dez handlers: não passou integralmente; há incompatibilidades de tipos dos SDKs legados e erros anteriores nos handlers/dependências. O novo helper usa uma fronteira de cliente servidor compatível entre versões, sem introduzir `any`. Não declarar typecheck global limpo.
- `git diff --check`: aprovado; preview informou `build OK`.
- Funções implantadas: as dez. Chamadas reais com chave pública, sem sessão humana: **401 em todas as dez**, sem usar documentos reais.
- Sessão administrativa disponível: status e listagem autenticada responderam **403 exigindo segundo fator**. Nenhuma validação MFA foi afrouxada.
- Permissões persistidas consultadas sem modificação: Mauricio/Juliana têm ações amplas de compras/fiscal/financeiro, visualização de PagCorp e criação/edição de vendas; Artur tem ações amplas nos módulos da etapa. Não foram concedidas baixas PagCorp a Mauricio/Juliana ou cancelamentos de vendas onde esses direitos não existiam.

## Limites e riscos restantes

- Testes autorizados foram isolados/sintéticos, não execuções de escrita SAP como as três pessoas. Falta validação autenticada ponta a ponta em Test com sessões legítimas, especialmente baixas, emissão/cancelamento e anexos. Sessão de Hiller disponível não comprova MFA nas ferramentas.
- Backend de preview e produção é compartilhado: nenhuma operação financeira real foi executada como teste.
- A autorização mantém administradores legítimos e responsáveis nos caminhos já existentes; não concede papel administrativo pela lista dos cinco usuários.
- Links de recibo fora da API confiável são explicitamente recusados. Se PagCorp usar CDN separada, requer origem oficial verificada e política separada sem encaminhar bearer; não aceitar URL arbitrária.
- Fase 3, cobertura global de endpoints/RPC/Storage, rotinas/chaves de integração e recuperação continuam pendentes. URLs de anexos previamente assinadas continuam com sua janela residual.

## Checklist de segurança do escopo

| Item | Estado |
|---|---|
| Empresa/ação/responsável antes de efeitos nas funções da etapa | OK nos testes isolados |
| Sem segredos novos no frontend, comandos, logs ou migrations | OK para as alterações |
| JWT/SAP e MFA existentes preservados | OK; sessão real recusada por MFA |
| URLs PagCorp sem encaminhamento indevido de token | OK nos testes |
| Schema/RLS/grants globais | Não alterados; auditoria global não reexecutada |
| CORS/cabeçalhos globais e HTTPS de todas as integrações | Não verificado globalmente; não ampliados por esta etapa |
| Senhas, confirmação de e-mail, SSO e brute force hospedados | Não verificado nesta etapa |
| Criptografia adicional de PII, CodeQL/secret scanning | Não verificado nesta etapa |
| Fluxos completos autenticados das três pessoas em Test | Pendente |
| Ativação do bloqueio | NO-GO |

**GO para as correções implantadas desta etapa; NO-GO para ativar o bloqueio ou declarar validação ponta a ponta completa.** Revisão guiada pela skill `revisao-seguranca-lovable`.
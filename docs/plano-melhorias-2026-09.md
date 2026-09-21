# Plano de resolução — avaliação de 21/09/2026

Ordem por prioridade (risco x esforço). Status atualizado conforme execução.

## P0 — Segurança (imediato)

1. **Empresas legíveis sem login** — política `Public can read active companies` expõe `service_layer_url`, CNPJ e razão social na tabela `companies` para visitantes anônimos.
   Ação: remover o acesso anônimo; se alguma tela pública precisar, criar visão restrita apenas com nome/código.
2. **56 funções SECURITY DEFINER executáveis por qualquer usuário logado**.
   Ação: revogar EXECUTE de `authenticated` nas funções administrativas e manter apenas as chamadas pelo app, validando papel dentro da função.
3. **3 tabelas com proteção ligada e nenhuma política** (`expense_audit_log`, `auth_caller_cache`, `edge_rate_limits`).
   Ação: declarar explicitamente "somente serviço" (sem política, com GRANT apenas para service_role) ou criar a política correta.
4. **Extensão instalada no schema público** — mover para `extensions`.

## P1 — Espaço e estabilidade do banco (disco 80%, memória 80%)

5. **Métricas de consulta (356 MB)** — CONCLUÍDO: tabela zerada; retenção automática de 14 dias já existente.
6. **Trilha de auditoria (3,9 GB)** — EM EXECUÇÃO: minimização de dados.
   - O gatilho passou a gravar apenas: autor, data/hora, tabela, operação, chave do registro e campos alterados. Conteúdo completo antes/depois não é mais armazenado.
   - Cadeia de hash preservada (prova de integridade continua válida).
   - Limpeza retroativa rodando em lotes (rotina temporária de 1 minuto, auto-desligável).
7. **Retenção das demais tabelas de telemetria** — `hana_health_probes` (72 MB), `edge_function_metrics` (49 MB), `overdue_reminder_log` (50 MB), `notification_send_runs` (39 MB): definir retenção de 30–90 dias e limpeza diária junto com as rotinas de poda já existentes.
8. **3,5 milhões de transações revertidas desde o último reinício** — investigar a origem (provável conflito em gravações de cache de integração) e corrigir o ponto de conflito.

## P2 — Performance de consultas

9. **Relatório de último acesso (`get_flow_last_login`)** — 4,4 s em média. Reescrever com índice adequado ou materializar o resultado.
10. **Fornecedores consultados 293 mil vezes** — cache em memória no cliente e menos recargas de tela.
11. **Gravações de cache do SAP (79 mil + 35 mil + 14 mil)** — gravar só o que mudou (comparar hash) em vez de reescrever a página inteira.

## P3 — Organização e fluxo

12. **50 rotinas automáticas ativas, várias sobrepostas** — consolidar as 5 de nota de entrada, as 4 de WhatsApp e as 3 de arquivamento; reduzir a base de carga constante.
13. **Identidade duplicada de usuário entre domínios de e-mail** — reforçar o cadastro único (chave canônica) em senha, permissão e notificação.
14. **Cinco telas de auditoria** — unificar em uma só com abas.

# Restrição web — validação de 19/11/2026

## Resultado
Preparação concluída; **NO-GO para ativação** até resolver os dois impedimentos abaixo. Nenhum usuário foi bloqueado, nenhuma integração ou perfil foi alterado.

## Identidades
- Confirmadas: Mauricio, Juliana, Artur, Douglas, duas contas de Hiller, Fernanda Faria e Bruna Padilha.
- Hiller corrigiu Flavia para `flavia.alves@growth.gg`; essa conta não existe no Auth. O diretório SAP contém Flavia Alves com outro e-mail, que não foi usado como substituição nem recebeu nova permissão.
- A ativação recusa contas obrigatórias ausentes/não confirmadas/não incluídas.

## Verificações realizadas
- 38 testes Vitest: cinco verificações de montagem/remoção da área interna, sete de admissão global e 26 de integrações/assinaturas.
- Ensaio PostgreSQL isolado com as migrations reais e dados sintéticos: oito pessoas/nove contas; conta pendente de Flavia impede ativação; outro administrador negado; MFA obrigatório; versão antiga negada; administradores de recuperação protegidos; admissão global independente; reabertura individual; desativação por Douglas; cinco alterações auditadas.
- Navegador com a sessão injetada: `/backoffice/controle-acesso` mostrou “Verificação em duas etapas”. Status web e global retornaram `enabled=false`, `admitted=true`, `manager=false`, versão 2. Não foi possível testar a gestão real além do MFA.
- Desktop 1280×1800 e mobile 390×844: tela MFA visível, sem erros de execução e sem transbordamento horizontal no mobile. Os controles administrativos ainda não foram inspecionados com MFA real.
- Último diagnóstico de compilação: OK.

## Limites e próximos requisitos
- Confirmar/criar a conta correta de Flavia pelo fluxo normal, sem criar conta automaticamente nem trocar e-mail SAP por inferência.
- Sessão administrativa de recuperação com MFA reconhecido para testar controles reais e ativar via RPC auditada.
- Esta restrição controla a interface web; não revoga credenciais ou acesso direto às APIs. Login e links externos de aprovação permanecem como antes. O bloqueio global e as proteções existentes de recursos/integrações não foram modificados.
- O funcionamento externo ponta a ponta das automações não foi declarado: consumidores externos não foram acessados.

## Arquivos alterados
- `src/App.tsx`, `src/components/ErpAccessGate.tsx`, `src/pages/ErpAccessControl.tsx`: navegação e controles separados.
- `src/components/ErpAccessGate.test.tsx`, `scripts/tests/erp-web-access-integration.py`: testes e ensaio.
- Migration `0082`, metadados gerenciados e tipos regenerados: campos e RPCs independentes.
- `AGENTS.md`, plano, roteiro e este relatório: decisão arquitetural e estado da entrega.
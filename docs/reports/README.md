# Relatório de Segurança V4.2 — atualização do V4.1

- [PDF atualizado, com anexos — 14 páginas](ERP_Flow_Relatorio_Seguranca_V4.2_com_Anexos.pdf)
- [Fonte HTML](ERP_Flow_Relatorio_Seguranca_V4.2_com_Anexos.html)
- [Integridade e origem dos 28 trechos literais](ERP_Flow_Relatorio_Seguranca_V4.2_com_Anexos.integrity.json)

Esta edição segue a estrutura do V4.1: resumo executivo, situação F01–F15 e plano de pendências. Acrescenta os novos achados e o ajuste funcional de reaprovação. São quatro páginas de relatório e dez anexos com explicações, trechos reais do código, linhas de origem, resultados registrados e limites da validação.

Os 28 recortes foram conferidos contra os commits citados. O PDF foi verificado quanto às 14 páginas, limites do texto, 44 links e hash, com revisão visual de páginas do relatório e dos anexos. Os testes citados são de execuções anteriores; esta emissão não reexecuta as suítes nem comprova implantação.

Para regenerar esta edição:

```sh
python3 scripts/security-review/generate-v42-executive.py
node scripts/security-review/render-v42-report.mjs ERP_Flow_Relatorio_Seguranca_V4.2_com_Anexos
```

A geração usa Python 3, Node, dependências do projeto e Google Chrome. O arquivo de integridade registra o SHA-256 do V4.1 utilizado como referência editorial, dos recortes e do PDF final. A renderização bloqueia rede externa.

---

# Cyber Assessment V4.2 — apresentação técnica anterior

- [PDF — 15 páginas](ERP_Flow_Cyber_Assessment_V4.2.pdf)
- [Fonte HTML](ERP_Flow_Cyber_Assessment_V4.2.html)
- [Integridade SHA-256 e fontes](ERP_Flow_Cyber_Assessment_V4.2.integrity.json)

Emissão de acompanhamento em 28/09/2026: estados F01–F15, N01–N04, controles, evidências, backlog B01–B20, critérios de aceite e ajuste funcional do PATCH SAP. Distingue validação local de encerramento operacional; implantação não comprovada. Commit e limites estão identificados no PDF.

Para gerar novamente na raiz do projeto (Python 3, Node, dependências do projeto e Google Chrome):

```sh
python3 scripts/security-review/generate-v42-report.py
node scripts/security-review/render-v42-report.mjs
```

A fonte editorial está no gerador Python. Ele confere os manifestos das rodadas V4.2/logout antes da emissão. O renderer bloqueia rede externa e recusa seções maiores que a área imprimível. Cada geração atualiza o hash do PDF; metadados de criação podem alterar seus bytes. A inspeção desta emissão confirmou 15 páginas, extração de texto, links e limites, com revisão visual de páginas representativas. Não reexecuta suites de segurança nem aplica migrações.

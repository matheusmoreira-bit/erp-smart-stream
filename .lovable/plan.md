# Backup de anexos com a sessão do administrador

## Permissão confirmada
A regra do Lovable Cloud proíbe código de cópia com `service_role`. O fluxo proposto usa apenas a sessão autenticada, as permissões já existentes e ZIPs locais; não amplia acesso nem usa funções de exportação administrativa.

Leitura pelas políticas atuais, com papel de administrador e MFA válido:

| Bucket | Leitura |
|---|---|
| sap-archive | Permitida |
| registration-attachments | Permitida pelo verificador existente de agente/admin |
| nf-entrada-files | Permitida |
| nfse-pdfs | Permitida |
| expense-attachments | Sem política de leitura; manter bloqueado |
| nfse-xmls | Sem política de leitura; manter bloqueado |

Todos os seis buckets são privados. Sem MFA, o verificador existente não reconhece a sessão como administradora. A conferência acima é das políticas, não um teste de download com a sessão de Douglas/Hiller.

## Página e downloads
1. Adicionar **Backup de anexos** ao menu administrativo, usando o controle de papel existente.
2. Listar os seis buckets, arquivos/MB autorizados à sessão, última contagem conhecida no Drive, data da conferência e subpasta de destino. A ausência de acesso não será apresentada como bucket vazio. Reaproveitar o mapeamento de `attachment-backup-notice`, sem mudar seu funcionamento.
3. Nos buckets legíveis, preparar ZIPs locais por bucket ou todos os permitidos, em partes de aproximadamente 200 MB. Se a informação existente não identificar precisamente os arquivos pendentes no Drive, permitir baixar os autorizados sem afirmar que são exclusivamente pendentes.
4. Preservar os nomes e a estrutura de destino, incluindo `arquivo-sap/<empresa>/anexos/...`; impedir caminhos inseguros e colisões silenciosas. Arquivos maiores que o limite serão informados separadamente, sem tentar carregá-los em um ZIP acima do limite.
5. Mostrar progresso, tentativas limitadas, cancelamento/retomada e falhas individuais. Manter checkpoint local por usuário, sem tokens, URLs sensíveis ou conteúdo dos arquivos persistido; entregar cada parte preparada por um clique de download.
6. Exibir a instrução solicitada: extrair o ZIP e arrastar a pasta para **ERP-Flow-Backup**, com o link do Drive. Não realizar upload ao Drive nem alterar o manifest.
7. Registrar a preparação/solicitação de download com o mecanismo de auditoria já autorizado à sessão. Não afirmar que o arquivo foi salvo no computador ou copiado ao Drive. Se a auditoria existente não permitir o registro seguro, apresentar esse bloqueio sem criar políticas ou acesso privilegiado.

## Limites técnicos
- Somente o client normal: chave pública + JWT do usuário; operações de listagem paginada e download sujeitas à RLS atual.
- Nenhuma função administrativa, `service_role`, nova política, alteração de permissões, exclusão, escrita de arquivo no Storage ou mudança de rotina de backup.
- Conferência do papel no servidor com o mecanismo existente antes da operação; RLS continua sendo a barreira de acesso aos arquivos.
- Status do Drive somente por leitura autorizada do estado já existente, sem chamar a função de inventário privilegiado. Mostrar informação indisponível/desatualizada quando necessário.
- Memória limitada a uma parte por vez, downloads com baixa concorrência e descarte dos blobs após entrega. ZIP de 200 MB ainda exige memória adicional do navegador; não prometer funcionamento em qualquer dispositivo.

## Teste e entrega
- Testes locais: teto de partes, caminhos preservados, colisões, buckets sem acesso, retomada e falhas.
- Testar `nfse-pdfs` pela página com sessão administrativa/MFA válida, baixar o ZIP e conferir tamanho, conteúdo PDF e caminho interno; verificar o registro de auditoria.
- Não baixar nem capturar documentos financeiros reais no preview compartilhado; se necessário, usar um arquivo sintético autorizado, sem alterar políticas.
- A sessão disponibilizada agora está `signed_out`. Tentar obter a sessão pelo mecanismo autorizado; se ela não comprovar MFA, manter o teste real **NO-GO**, sem contornar a proteção nem solicitar códigos no chat.
- Informar arquivos alterados, testes executados e bloqueios restantes. Não publicar automaticamente.
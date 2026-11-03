# Complemento: leitura dos seis buckets no Backup de anexos

## SQL exato para sua aprovação

Esta será a única instrução da migration. **Ainda não foi aplicada.**

```sql
CREATE POLICY "attachment_backup_admin_read"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id IN ('expense-attachments', 'nfse-xmls')
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);
```

O verificador `has_role` foi conferido no banco: quando verifica o próprio usuário autenticado como administrador, exige `aal2` (MFA). A política usa exatamente esse critério, como a leitura administrativa de `sap-archive`.

- Uma política, somente SELECT, para dois buckets.
- Sem INSERT, UPDATE, DELETE, GRANT adicional ou alteração de outras políticas.
- Os dois buckets foram conferidos como privados e continuarão privados.
- Sem mudança no verificador de administrador, funções administrativas, `service_role` ou emissão de signed URLs pelo servidor.

## Após a aprovação
1. Aplicar exatamente o SQL acima e ler de volta a política; confirmar que as demais políticas e o caráter privado dos buckets continuam inalterados.
2. Remover somente o bloqueio local de `expense-attachments` e `nfse-xmls` na página de ZIPs. Os seis buckets passam pelo mesmo fluxo de listagem e download com sessão autenticada, respeitando a RLS e sem escrita no Storage.
3. Atualizar o teste que esperava esses dois buckets bloqueados. Testar a nova política para negar usuários comuns/admin sem MFA e permitir admin com MFA; manter os testes de limite de ZIP, caminhos, tentativas e retomada.
4. Tentar o download real de `nfse-pdfs` e, se possível, um arquivo de `expense-attachments`, apenas com sessão legitimamente administrativa e MFA, sem expor documentos reais no preview. Conferir ZIP, caminho interno e auditoria. Se a sessão disponível continuar sem MFA, informar o bloqueio e não contornar a proteção.
5. Informar arquivos alterados, testes executados e GO/NO-GO. Não publicar automaticamente nem modificar o status do Drive, manifest ou outras rotinas.

## Arquivos previstos
- Migration contendo a política aprovada.
- `src/lib/attachment-backup.ts` e `src/lib/attachment-backup.test.ts` para retirar o bloqueio fixo dos dois buckets.
- `src/pages/AttachmentBackup.tsx` somente se necessário para remover a dependência desse bloqueio.
- `AGENTS.md` e `roadmap.md` para registrar a exceção autorizada e o resultado.

A aprovação deste complemento autoriza aplicar o SQL exato apresentado acima; até lá, banco e página permanecem inalterados.
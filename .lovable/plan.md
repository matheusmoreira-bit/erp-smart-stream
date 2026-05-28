## Objetivo
Hoje a página `/notifications` (com a aba "Histórico de envios" do WhatsApp) só é acessível pelo sininho no header. Vou adicionar um card dedicado **Notificações** no menu principal (`MainMenu`), no grupo **Admin**, para acesso direto.

## Mudanças

**`src/components/MainMenu.tsx`**
- Importar ícone `Bell` do `lucide-react`.
- Adicionar entrada em `modules`:
  - `title`: "Notificações"
  - `description`: "Central de notificações, preferências, auditoria e histórico de envios (WhatsApp, e-mail)."
  - `path`: `/notifications`
  - `icon`: `Bell`
  - `moduleKey`: `notifications`
- Incluir `"notifications"` no grupo **Admin** (ordenação alfabética automática já existe).

## Observação sobre permissão
O `moduleKey` `notifications` provavelmente ainda não está cadastrado no controle de acesso (`useModuleAccess`). Como `MainMenu` usa `userModules.includes(mod.moduleKey)`, o card pode aparecer bloqueado para não-admins até o módulo ser liberado em **Admin → Permissões**. Posso:
- (a) deixar como está (admin libera depois), ou
- (b) já adicionar `notifications` à lista de módulos conhecidos do sistema.

Sigo com (a) salvo se você preferir (b).

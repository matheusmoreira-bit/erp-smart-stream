import { Fragment, type ComponentType, type ReactNode } from "react";
import { MoreHorizontal, type LucideProps } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type RowActionIcon = ComponentType<LucideProps>;

export interface RowAction {
  /** Chave estável para React. */
  key: string;
  /** Rótulo visível no item. */
  label: ReactNode;
  /** Ícone à esquerda (opcional). */
  icon?: RowActionIcon;
  /** Handler do clique. */
  onSelect?: () => void;
  /** Desabilita o item. */
  disabled?: boolean;
  /** Oculta o item (útil para exibição condicional em linhas). */
  hidden?: boolean;
  /** Marca como ação destrutiva (vermelho). */
  destructive?: boolean;
  /** Insere um separador ANTES deste item. */
  separatorBefore?: boolean;
  /** Texto do `title`/tooltip do item. */
  title?: string;
}

export interface RowActionsMenuProps {
  actions: RowAction[];
  /** Rótulo acessível do gatilho. */
  triggerLabel?: string;
  /** Título do menu (aparece como cabeçalho). */
  menuLabel?: string;
  /** Alinhamento do popover. */
  align?: "start" | "center" | "end";
  /** Desabilita o gatilho por completo (ex.: linha em processamento). */
  disabled?: boolean;
  /** Classe extra no gatilho. */
  triggerClassName?: string;
  /** Classe extra no conteúdo do menu. */
  contentClassName?: string;
  /** Ícone alternativo para o gatilho. */
  triggerIcon?: RowActionIcon;
}

/**
 * Menu de ações por linha, padrão para tabelas: gatilho de ícone (⋯) que abre
 * um dropdown com itens compostos por ícone + descrição.
 *
 * Uso:
 * ```tsx
 * <RowActionsMenu
 *   actions={[
 *     { key: "edit", label: "Editar", icon: Pencil, onSelect: () => ... },
 *     { key: "cancel", label: "Cancelar", icon: XCircle,
 *       destructive: true, separatorBefore: true, onSelect: () => ... },
 *   ]}
 * />
 * ```
 *
 * Regras:
 * - Itens com `hidden: true` são omitidos.
 * - Separadores duplicados/no início/no fim são removidos automaticamente.
 * - Envolva o `<TableCell>` de origem com `onClick={(e) => e.stopPropagation()}`
 *   se a linha for clicável (para não abrir o detalhe ao usar o menu).
 */
export function RowActionsMenu({
  actions,
  triggerLabel = "Ações",
  menuLabel,
  align = "end",
  disabled,
  triggerClassName,
  contentClassName,
  triggerIcon: TriggerIcon = MoreHorizontal,
}: RowActionsMenuProps) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={triggerLabel}
          disabled={disabled}
          className={cn("h-8 w-8", triggerClassName)}
          onClick={(e) => e.stopPropagation()}
        >
          <TriggerIcon className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn("w-56", contentClassName)}
        onClick={(e) => e.stopPropagation()}
      >
        {menuLabel && (
          <>
            <DropdownMenuLabel>{menuLabel}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {visible.map((action, index) => {
          const Icon = action.icon;
          const showSep =
            action.separatorBefore &&
            index > 0 &&
            // Evita separador logo após o cabeçalho ou outro separador
            !visible[index - 1]?.separatorBefore;
          return (
            <Fragment key={action.key}>
              {showSep && <DropdownMenuSeparator />}
              <DropdownMenuItem
                disabled={action.disabled}
                title={action.title}
                onSelect={(e) => {
                  // Preserva comportamento padrão (fecha o menu) e chama o handler.
                  action.onSelect?.();
                }}
                className={cn(
                  action.destructive && "text-destructive focus:text-destructive",
                )}
              >
                {Icon && <Icon className="w-4 h-4 mr-2" />}
                {action.label}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default RowActionsMenu;

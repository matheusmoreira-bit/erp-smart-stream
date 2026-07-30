import { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";

interface BackofficePageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Rota do botão voltar (default: "/backoffice") */
  backTo?: string;
}

/**
 * Cabeçalho das telas internas do Backoffice.
 * Usa o mesmo cabeçalho unificado do restante do sistema (PageHeader),
 * garantindo empresa/usuário, tema e navegação consistentes.
 */
export function BackofficePageHeader({
  title,
  description,
  icon,
  actions,
  backTo = "/backoffice",
}: BackofficePageHeaderProps) {
  return (
    <PageHeader
      icon={icon ?? null}
      title="Backoffice"
      titleAccent={title}
      subtitle={description}
      documentTitle={title}
      backTo={backTo}
      actions={actions}
    />
  );
}

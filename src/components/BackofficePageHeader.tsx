import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/PageTitle";

interface BackofficePageHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
}

/**
 * Cabeçalho padrão das telas internas do Backoffice:
 * barra fixa com botão "Voltar", título da página e ações opcionais.
 */
export function BackofficePageHeader({ title, description, icon, actions }: BackofficePageHeaderProps) {
  const navigate = useNavigate();

  return (
    <>
      <PageTitle title={title} />
      <header className="sticky top-0 z-30 -mx-6 mb-2 border-b border-border bg-card/80 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/backoffice")} aria-label="Voltar">
            <ArrowLeft className="mr-1 h-4 w-4" /> Backoffice
          </Button>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-lg font-semibold text-foreground">
              {icon}
              {title}
            </h1>
            {description && (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      </header>
    </>
  );
}

import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageTitle } from "@/components/PageTitle";
import { UserCompanyMenu } from "@/components/UserCompanyMenu";
import cactusLogo from "@/assets/cactus-logo.png.asset.json";


interface PageHeaderProps {
  /** Ícone à esquerda do título (ex.: Receipt, CreditCard) */
  icon: ReactNode;
  /** Parte inicial do título (ex.: "Vendas") */
  title: string;
  /** Sufixo em gradiente (ex.: "NFs de venda") — renderizado após " — " */
  titleAccent?: string;
  /** Subtítulo pequeno abaixo do título */
  subtitle?: string;
  /** Título usado no <title> do documento (defaults to `title`) */
  documentTitle?: string;
  /** Rota do botão voltar (default: "/") */
  backTo?: string;
  /** Ações extras à esquerda do bloco empresa/usuário (ex.: botões Histórico/Atualizar) */
  actions?: ReactNode;
  /** Empresa exibida no bloco à direita */
  companyLabel?: string;
  /** Nome do usuário exibido no bloco à direita */
  userName?: string;
  /** Estado de conexão (mostra pílula verde "Conectado" quando true) */
  connected?: boolean;
  /** Handler do botão de logout. Quando ausente, o botão não é renderizado. */
  onLogout?: () => void;
  /** Variante visual do chrome principal. */
  system?: "public" | "backoffice";
  /** Oculta o botão voltar em telas raiz, como o painel de módulos. */
  showBack?: boolean;
}

/**
 * Cabeçalho padrão das páginas internas do sistema.
 * Uso: <PageHeader icon={<Receipt ... />} title="Vendas" titleAccent="NFs de venda" ... />
 */
export function PageHeader({
  icon,
  title,
  titleAccent,
  subtitle,
  documentTitle,
  backTo = "/",
  actions,
  system = "public",
  showBack = true,
}: PageHeaderProps) {
  const navigate = useNavigate();
  const brandLabel = system === "backoffice" ? "Backoffice" : "ERP Flow";
  const brandSubtitle = system === "backoffice" ? "Administração" : "Sistema";

  return (
    <>
      <PageTitle title={documentTitle ?? title} />
      <header className="border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(system === "backoffice" ? "/backoffice" : "/")}
              className="flex shrink-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/50"
              aria-label={system === "backoffice" ? "Ir para o Backoffice" : "Ir para o painel"}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10">
                <img src={cactusLogo.url} alt="Cactus" className="h-6 w-6 object-contain" />
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block text-sm font-semibold leading-tight text-foreground">{brandLabel}</span>
                <span className="block text-[11px] leading-tight text-muted-foreground">{brandSubtitle}</span>
              </span>
            </button>

            <div className="hidden h-8 w-px bg-border sm:block" />

            {showBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate(backTo)}
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                aria-label="Voltar"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
            )}

            {icon ? <div className="hidden rounded-md bg-primary/10 p-2 sm:block">{icon}</div> : null}
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
                {title}
                {titleAccent ? <span className="text-gradient"> / {titleAccent}</span> : null}
              </h1>
              {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <ThemeToggle />
            <UserCompanyMenu />
          </div>

        </div>
      </header>
    </>
  );
}

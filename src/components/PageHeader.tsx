import { ReactNode } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PageTitle } from "@/components/PageTitle";

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
  companyLabel,
  userName,
  connected = true,
  onLogout,
}: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <>
      <PageTitle title={documentTitle ?? title} />
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(backTo)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Voltar"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-primary/10">{icon}</div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {title}
                {titleAccent ? (
                  <span className="text-gradient"> — {titleAccent}</span>
                ) : null}
              </h1>
              {subtitle ? (
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {actions}
            <ThemeToggle />
            <UserCompanyMenu />
          </div>

        </div>
      </header>
    </>
  );
}

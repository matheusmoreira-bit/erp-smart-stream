import React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: React.ReactNode;
  /** Callback opcional para fechar o modal que envolve o boundary. */
  onClose?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Evita a "tela preta": quando algo dentro de um modal quebra no render, o
 * React desmonta a árvore e sobra apenas o overlay escuro. Aqui capturamos o
 * erro, mantemos o conteúdo do modal e oferecemos recuperar ou fechar.
 */
export class ModalErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[modal-error-boundary]", error, info?.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h2 className="text-sm font-semibold">Algo deu errado ao exibir este formulário</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Seus anexos não foram perdidos. Tente novamente — se o erro persistir, feche e reabra o
          formulário.
        </p>
        <pre className="max-h-40 w-full overflow-auto rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
          {String(error?.message || error)}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" onClick={this.reset}>
            Tentar novamente
          </Button>
          {this.props.onClose && (
            <Button size="sm" variant="outline" onClick={this.props.onClose}>
              Fechar
            </Button>
          )}
        </div>
      </div>
    );
  }
}

export default ModalErrorBoundary;

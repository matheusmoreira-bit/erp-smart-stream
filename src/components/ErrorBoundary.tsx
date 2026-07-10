import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("ErrorBoundary caught:", error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center space-y-3">
        <div className="flex justify-center">
          <AlertTriangle className="w-8 h-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          {this.props.fallbackTitle || "Não foi possível carregar esta seção"}
        </h3>
        <p className="text-sm text-muted-foreground">
          {this.props.fallbackMessage ||
            "Ocorreu um erro ao processar os dados. Tente recarregar ou selecionar outro período."}
        </p>
        {this.state.error?.message && (
          <p className="text-xs text-muted-foreground/70 font-mono">{this.state.error.message}</p>
        )}
        <Button variant="outline" size="sm" onClick={this.reset}>
          Tentar novamente
        </Button>
      </div>
    );
  }
}

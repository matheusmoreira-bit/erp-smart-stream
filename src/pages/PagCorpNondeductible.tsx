import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Pencil, ShieldOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useSap } from "@/contexts/SapContext";
import { useCompanies } from "@/hooks/useCompanies";
import { usePagCorp } from "@/hooks/usePagCorp";
import {
  useNondeductibleCards,
  resolveCardIdentifier,
  type NondeductibleCard,
} from "@/hooks/useNondeductibleCards";
import { PagCorpNondeductibleDialog } from "@/components/PagCorpNondeductibleDialog";
import { toast } from "sonner";

export default function PagCorpNondeductible() {
  const navigate = useNavigate();
  const { session } = useSap();
  const { getLabel } = useCompanies(true);
  const { items, loading, upsert, remove } = useNondeductibleCards(session?.companyDB);
  const { transactions, fetchTransactions } = usePagCorp();
  const [editing, setEditing] = useState<NondeductibleCard | null>(null);
  const [open, setOpen] = useState(false);

  // Carrega últimas transações para sugerir cartões
  useEffect(() => {
    if (!session?.companyDB) return;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    fetchTransactions(start.toISOString().slice(0, 10), today.toISOString().slice(0, 10), session.companyDB);
  }, [fetchTransactions, session?.companyDB]);

  const cardSuggestions = useMemo(() => {
    const seen = new Map<string, { identifier: string; label: string; holder?: string }>();
    transactions.forEach((t) => {
      const id = resolveCardIdentifier(t as any);
      if (!id) return;
      if (!seen.has(id)) {
        const label = t.cardName || t.accountAlias || t.accountName || id;
        seen.set(id, { identifier: id, label, holder: t.accountAlias || undefined });
      }
    });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [transactions]);

  const companyLabel = getLabel(session?.companyDB || "");

  const handleDelete = async (item: NondeductibleCard) => {
    if (!confirm(`Remover o cartão "${item.card_label || item.card_identifier}" da lista de indedutíveis?`)) return;
    try {
      await remove(item.id);
      toast.success("Cartão removido");
    } catch (e) {
      toast.error("Falha ao remover", { description: e instanceof Error ? e.message : "Erro" });
    }
  };

  const handleSubmit = async (input: any, id?: string) => {
    try {
      await upsert(input, id);
      toast.success(id ? "Cartão atualizado" : "Cartão adicionado");
    } catch (e) {
      toast.error("Falha ao salvar", { description: e instanceof Error ? e.message : "Erro" });
      throw e;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/pagcorp")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="p-2 rounded-lg bg-muted">
              <ShieldOff className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Cartões Indedutíveis</h1>
              <p className="text-xs text-muted-foreground">
                {companyLabel} • Cartões isentos de prestação de contas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => { setEditing(null); setOpen(true); }} className="gap-2">
              <Plus className="w-4 h-4" /> Adicionar cartão
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <div className="glass-card overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ShieldOff className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nenhum cartão indedutível cadastrado</p>
                <p className="text-sm mt-1">
                  Adicione cartões/portadores que não exigem prestação de contas.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Identificador</TableHead>
                    <TableHead>Rótulo</TableHead>
                    <TableHead>Portador</TableHead>
                    <TableHead>Fornecedor SAP</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-sm">{c.card_identifier}</TableCell>
                      <TableCell>{c.card_label || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.card_holder || "—"}</TableCell>
                      <TableCell>
                        <span className="font-medium">{c.supplier_code}</span>
                        {c.supplier_name && (
                          <span className="text-muted-foreground ml-2 text-sm">{c.supplier_name}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(c); setOpen(true); }}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(c)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </main>

      <PagCorpNondeductibleDialog
        open={open}
        onClose={() => setOpen(false)}
        editing={editing}
        cardSuggestions={cardSuggestions}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

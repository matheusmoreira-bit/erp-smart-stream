import ExpensesPage from "./Expenses.tsx";
import SalesReceivables from "./Sales.tsx";
import SalesNfse from "./SalesNfse.tsx";
import SalesRecipientsTab from "@/components/SalesRecipientsTab";
import { SalesTabs } from "@/components/SalesTabs";

export type SalesTab = "orders" | "nfse" | "receivables" | "recipients";

/**
 * Hub do ciclo de vendas: Pedido de Venda → NFS-e → Contas a Receber → Destinatários.
 * Cada aba mantém a tela dedicada, com a navegação fixa no topo.
 */
export default function SalesHub({ tab }: { tab: SalesTab }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SalesTabs />
      {tab === "orders" && <ExpensesPage mode="sales" />}
      {tab === "nfse" && <SalesNfse />}
      {tab === "receivables" && <SalesReceivables />}
      {tab === "recipients" && <SalesRecipientsTab />}
    </div>
  );
}

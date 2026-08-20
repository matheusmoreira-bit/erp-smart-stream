import { SubmenuBar } from "@/components/SubmenuBar";
import { useNavigate } from "react-router-dom";
import { useLocation } from "react-router-dom";

const TABS = [
  { to: "/vendas/pedidos", label: "Pedidos de Venda" },
  { to: "/vendas/nfse", label: "NFS-e" },
  { to: "/vendas/adiantamentos", label: "Adiantamentos" },
  { to: "/vendas/recebimentos", label: "Contas a Receber" },
  { to: "/vendas/destinatarios", label: "Destinatários" },
];

/** Submenu do ciclo de vendas. */
export function SalesTabs() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = TABS.find((t) => pathname.startsWith(t.to))?.to ?? TABS[0].to;

  return (
    <SubmenuBar
      moduleLabel="Vendas"
      items={TABS.map((t) => ({ key: t.to, label: t.label }))}
      active={active}
      onSelect={(key) => navigate(key)}
    />
  );
}

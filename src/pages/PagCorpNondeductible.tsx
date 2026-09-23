import { Navigate } from "react-router-dom";

/** Rota antiga: Indedutíveis agora é uma aba do Mapeamento de Cartões. */
export default function PagCorpNondeductible() {
  return <Navigate to="/cartoes/mapeamento?tab=nondeductible" replace />;
}

import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  Bot,
  Boxes,
  CalendarDays,
  ExternalLink,
  GitCommitHorizontal,
  History,
  Plug,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
} from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ItemKind =
  "modulo" | "funcao" | "melhoria" | "integracao" | "automacao" | "seguranca";

type EvidenceKind = "foundation" | "first-delivery" | "feature";

interface RoadmapItem {
  date: string;
  commit: string;
  title: string;
  kind: ItemKind;
  track: string;
  description: string;
  evidence: EvidenceKind;
}

const REPOSITORY_URL = "https://github.com/matheusmoreira-bit/erp-smart-stream";

const KIND_META: Record<
  ItemKind,
  { label: string; icon: typeof Boxes; className: string }
> = {
  modulo: {
    label: "Módulo",
    icon: Boxes,
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  funcao: {
    label: "Função",
    icon: Sparkles,
    className: "border-border bg-accent/40 text-accent-foreground",
  },
  melhoria: {
    label: "Melhoria",
    icon: Rocket,
    className: "border-border bg-muted text-muted-foreground",
  },
  integracao: {
    label: "Integração",
    icon: Plug,
    className: "border-border bg-secondary text-secondary-foreground",
  },
  automacao: {
    label: "Automação",
    icon: Bot,
    className: "border-border bg-muted text-foreground",
  },
  seguranca: {
    label: "Segurança",
    icon: ShieldCheck,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
};

const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  foundation: "Fundação do repositório",
  "first-delivery": "Primeiro commit da entrega",
  feature: "Evolução registrada",
};

const milestone = (
  date: string,
  commit: string,
  title: string,
  kind: ItemKind,
  track: string,
  description: string,
  evidence: EvidenceKind = "first-delivery",
): RoadmapItem => ({ date, commit, title, kind, track, description, evidence });

/**
 * Marcos curados a partir do histórico Git. Merges, manutenção interna e
 * correções sem mudança funcional foram omitidos para manter a leitura útil.
 */
const CHANGELOG: RoadmapItem[] = [
  milestone(
    "2025-01-01",
    "95d05da0",
    "Fundação técnica do frontend",
    "melhoria",
    "Plataforma",
    "Criação do repositório e da base React/Vite que passou a sustentar o ERP Flow.",
    "foundation",
  ),
  milestone(
    "2026-04-09",
    "56fd95bc",
    "Home e analytics operacionais",
    "modulo",
    "Dados e analytics",
    "Primeiro painel operacional e navegação para organizar os módulos do produto.",
  ),
  milestone(
    "2026-04-09",
    "6167ebcc",
    "Conectividade com SAP Business One",
    "integracao",
    "Integrações ERP",
    "Primeiro fluxo de autenticação e comunicação com o Service Layer do SAP.",
    "feature",
  ),
  milestone(
    "2026-04-09",
    "ca23261b",
    "Aprovações",
    "modulo",
    "Aprovações",
    "Área para acompanhar documentos submetidos e decisões dos aprovadores.",
  ),
  milestone(
    "2026-04-09",
    "5ed91f5c",
    "Despesas e pedidos de compra",
    "modulo",
    "Compras e despesas",
    "Estrutura inicial de despesas, itens e anexos que originou o fluxo de compras.",
  ),
  milestone(
    "2026-04-09",
    "8cbadd26",
    "Matriz e regras de aprovação",
    "modulo",
    "Aprovações",
    "Definição de regras, níveis de alçada e responsáveis pela aprovação.",
  ),
  milestone(
    "2026-04-09",
    "16a302df",
    "PagCorp",
    "modulo",
    "PagCorp",
    "Consulta de transações de cartões corporativos por meio do proxy PagCorp.",
  ),
  milestone(
    "2026-04-09",
    "8fc0fb26",
    "Credenciais de integração",
    "seguranca",
    "Governança e segurança",
    "Cadastro protegido das credenciais usadas pelos conectores internos.",
  ),
  milestone(
    "2026-04-09",
    "4968a98e",
    "Leitura de documentos com IA",
    "automacao",
    "Experiência e inteligência",
    "Extração assistida para preencher despesas a partir dos anexos.",
    "feature",
  ),
  milestone(
    "2026-04-09",
    "ffdda242",
    "Mapeamento contábil do PagCorp",
    "modulo",
    "PagCorp",
    "Regras entre transações corporativas e dimensões contábeis.",
  ),
  milestone(
    "2026-04-10",
    "704799e2",
    "Usuários e permissões",
    "modulo",
    "Governança e segurança",
    "Cadastro administrativo de usuários e base do controle de acesso.",
  ),
  milestone(
    "2026-04-10",
    "2528a4ae",
    "Integração de identidades com JumpCloud",
    "integracao",
    "Identidade",
    "Mapeamento entre identidades corporativas e usuários internos.",
  ),
  milestone(
    "2026-04-10",
    "8bc10581",
    "Synapse",
    "modulo",
    "Dados e analytics",
    "Estruturas de dados e políticas do módulo de análise Synapse.",
  ),
  milestone(
    "2026-04-10",
    "613334c5",
    "Administração multiempresa",
    "modulo",
    "Plataforma",
    "Cadastro de empresas e seleção do contexto empresarial.",
  ),
  milestone(
    "2026-04-10",
    "ee6a76fa",
    "Auditoria e histórico de integrações",
    "modulo",
    "Auditoria e observabilidade",
    "Primeiras trilhas de auditoria e histórico das comunicações externas.",
  ),
  milestone(
    "2026-04-14",
    "f373a06e",
    "Central de notificações",
    "modulo",
    "Experiência e inteligência",
    "Acompanhamento de avisos, decisões e eventos relevantes.",
  ),
  milestone(
    "2026-04-17",
    "a70b163b",
    "Fornecedores",
    "modulo",
    "Fiscal e cadastros",
    "Cadastro e consulta de fornecedores utilizados nos fluxos financeiros.",
  ),
  milestone(
    "2026-04-17",
    "a7e16ff2",
    "Monitor de integrações",
    "modulo",
    "Integrações ERP",
    "Visão operacional do processamento e resultado das integrações.",
  ),
  milestone(
    "2026-05-05",
    "7bcc7351",
    "Intercompany",
    "modulo",
    "Cadastros compartilhados",
    "Área para administrar e replicar cadastros entre empresas.",
  ),
  milestone(
    "2026-05-05",
    "96605069",
    "Revisão financeira",
    "modulo",
    "Financeiro",
    "Conferência financeira e acompanhamento dos lançamentos.",
  ),
  milestone(
    "2026-05-12",
    "2ae4e7df",
    "Gestão e análise de licenças",
    "modulo",
    "Governança e segurança",
    "Importação e análise de licenças para acompanhar uso e disponibilidade.",
  ),
  milestone(
    "2026-05-18",
    "1dfc251b",
    "Vendas",
    "modulo",
    "Vendas",
    "Fluxo comercial para criar e acompanhar pedidos de venda.",
  ),
  milestone(
    "2026-05-23",
    "ba52aad5",
    "Produtividade dos usuários",
    "modulo",
    "Dados e analytics",
    "Indicadores de atividade e produtividade por usuário.",
  ),
  milestone(
    "2026-05-28",
    "af25639f",
    "Histórico de aprovações",
    "modulo",
    "Aprovações",
    "Visão consolidada das decisões e movimentações das aprovações.",
  ),
  milestone(
    "2026-06-10",
    "cd8879e6",
    "Indedutíveis do PagCorp",
    "modulo",
    "PagCorp",
    "Tratamento das transações classificadas como indedutíveis.",
  ),
  milestone(
    "2026-06-11",
    "12670d26",
    "Auditoria fiscal",
    "modulo",
    "Fiscal e cadastros",
    "Rotinas de análise e conferência dos dados fiscais.",
  ),
  milestone(
    "2026-06-11",
    "d0375a65",
    "Cadastro de itens",
    "modulo",
    "Fiscal e cadastros",
    "Manutenção do catálogo de itens utilizado nas integrações.",
  ),
  milestone(
    "2026-06-12",
    "fc7d6144",
    "Notas fiscais de entrada",
    "modulo",
    "Compras e despesas",
    "Monitor de NFs e de seus vínculos com pedidos e documentos do ERP.",
  ),
  milestone(
    "2026-06-12",
    "e8282a8f",
    "Administração de usuários SAP",
    "modulo",
    "Identidade",
    "Gestão dos usuários SAP a partir do backoffice.",
  ),
  milestone(
    "2026-06-16",
    "62b9170d",
    "Replicação de usuários SAP",
    "automacao",
    "Identidade",
    "Replicação de usuários e configurações entre bases SAP.",
  ),
  milestone(
    "2026-06-17",
    "dee617f5",
    "Hubs operacionais do backoffice",
    "melhoria",
    "Plataforma",
    "Organização de aprovações, auditoria, integrações e usuários em hubs.",
    "feature",
  ),
  milestone(
    "2026-06-18",
    "309fd5bc",
    "Adiantamentos",
    "modulo",
    "Financeiro",
    "Fluxo de adiantamentos e acompanhamento de sua integração.",
  ),
  milestone(
    "2026-07-02",
    "3112a838",
    "Trilha de auditoria detalhada",
    "modulo",
    "Auditoria e observabilidade",
    "Consulta cronológica para investigar alterações e ações.",
  ),
  milestone(
    "2026-07-07",
    "f1909949",
    "Sincronização de status SAP",
    "automacao",
    "Integrações ERP",
    "Monitoramento dos ciclos e estados dos documentos enviados ao SAP.",
  ),
  milestone(
    "2026-07-07",
    "9657089e",
    "Histórico de transferências",
    "modulo",
    "Aprovações",
    "Rastreabilidade das transferências entre aprovadores.",
  ),
  milestone(
    "2026-07-14",
    "4a985bc0",
    "Auditoria fiscal cruzada",
    "modulo",
    "Fiscal e cadastros",
    "Conferência cruzada de documentos para localizar divergências.",
  ),
  milestone(
    "2026-07-15",
    "dce32001",
    "Histórico de baixas",
    "modulo",
    "Financeiro",
    "Consulta de baixas financeiras e resultados de integração.",
  ),
  milestone(
    "2026-07-16",
    "6cb0661d",
    "Integração de colaboradores",
    "integracao",
    "Identidade",
    "Sincronização de colaboradores com os sistemas corporativos.",
  ),
  milestone(
    "2026-07-22",
    "fae683f9",
    "Copiloto do backoffice",
    "modulo",
    "Experiência e inteligência",
    "Assistente para consultas e apoio às rotinas administrativas.",
  ),
  milestone(
    "2026-07-23",
    "fccff784",
    "Saúde da infraestrutura",
    "modulo",
    "Auditoria e observabilidade",
    "Disponibilidade dos serviços e dependências essenciais.",
  ),
  milestone(
    "2026-07-24",
    "8dc9a620",
    "Fila de retentativas",
    "modulo",
    "Integrações ERP",
    "Acompanhamento e reexecução das operações que falharam.",
  ),
  milestone(
    "2026-07-29",
    "06de95ec",
    "KYP e solicitações de cadastro",
    "modulo",
    "Governança e segurança",
    "Auditoria KYP e fluxo de solicitações para novos cadastros.",
  ),
  milestone(
    "2026-07-29",
    "2fad78fe",
    "Hub de vendas e NFS-e",
    "modulo",
    "Vendas",
    "Organização da operação comercial e entrada da gestão de NFS-e.",
  ),
  milestone(
    "2026-07-30",
    "6315a679",
    "Matriz visual de aprovações",
    "modulo",
    "Aprovações",
    "Visão administrativa das alçadas, regras e aprovadores.",
  ),
  milestone(
    "2026-07-30",
    "4c352bcc",
    "SLA e saúde das integrações",
    "modulo",
    "Auditoria e observabilidade",
    "Escalonamento por SLA e acompanhamento da saúde dos conectores.",
  ),
  milestone(
    "2026-07-30",
    "f0e3c0cd",
    "Aprovações no celular",
    "modulo",
    "Aprovações",
    "Experiência mobile para analisar e decidir documentos.",
  ),
  milestone(
    "2026-07-30",
    "b15fc4c4",
    "Revisão de acessos",
    "seguranca",
    "Governança e segurança",
    "Revisão de administradores, grupos e permissões efetivas.",
  ),
  milestone(
    "2026-08-01",
    "fd9d71b3",
    "Conciliação do PagCorp",
    "modulo",
    "PagCorp",
    "Acompanhamento de prestações e liquidações corporativas.",
  ),
  milestone(
    "2026-08-03",
    "63fa2fa8",
    "Previsão de caixa",
    "modulo",
    "Financeiro",
    "Projeção financeira baseada nos vencimentos dos documentos.",
  ),
  milestone(
    "2026-08-03",
    "68eced4b",
    "Notificações push nativas",
    "funcao",
    "Experiência e inteligência",
    "Avisos de aprovações e eventos importantes também por Web Push.",
    "feature",
  ),
  milestone(
    "2026-08-05",
    "ee30fcc5",
    "Governança de notificações",
    "modulo",
    "Governança e segurança",
    "Controles de canais, preferências e comportamento das notificações.",
  ),
  milestone(
    "2026-08-06",
    "45b63390",
    "Desempenho de banco e fluxos",
    "modulo",
    "Auditoria e observabilidade",
    "Métricas de banco de dados e tempos dos principais fluxos.",
  ),
  milestone(
    "2026-08-07",
    "076d67d3",
    "Login desacoplado do ERP",
    "seguranca",
    "Identidade",
    "Autenticação do ERP resolvida sob demanda, sem prender a sessão do usuário.",
    "feature",
  ),
  milestone(
    "2026-08-11",
    "5a3e4358",
    "Chaves de API e auditoria unificada",
    "modulo",
    "Governança e segurança",
    "Gestão de chaves e visão unificada para consultas de auditoria.",
  ),
  milestone(
    "2026-08-18",
    "04c66fb8",
    "Acesso de usuários por empresa",
    "seguranca",
    "Governança e segurança",
    "Escopo de acesso passou a respeitar as empresas de cada usuário.",
    "feature",
  ),
  milestone(
    "2026-08-18",
    "7a113797",
    "Mapa de relações dos documentos SAP",
    "funcao",
    "Integrações ERP",
    "Reconciliação visual entre pedido, aprovação, nota e financeiro.",
    "feature",
  ),
  milestone(
    "2026-08-19",
    "e8a6d62a",
    "Emissão de NFS-e pelas vendas",
    "integracao",
    "Vendas",
    "Pedidos de venda passaram a originar a emissão de NFS-e.",
    "feature",
  ),
  milestone(
    "2026-08-19",
    "75796746",
    "Adiantamentos de clientes",
    "funcao",
    "Vendas",
    "Processo financeiro de adiantamentos recebidos de clientes.",
    "feature",
  ),
  milestone(
    "2026-08-20",
    "30ec5f91",
    "Integração SAP resiliente",
    "melhoria",
    "Integrações ERP",
    "Recuperação e estados operacionais para indisponibilidades do SAP.",
    "feature",
  ),
  milestone(
    "2026-08-20",
    "241e4f1a",
    "PagCorp por lançamento contábil",
    "integracao",
    "PagCorp",
    "Transações passaram a ser integradas em lote como lançamentos manuais.",
    "feature",
  ),
  milestone(
    "2026-08-20",
    "03fdd626",
    "Persistência da análise de IA",
    "automacao",
    "PagCorp",
    "Resultado da leitura dos anexos salvo para evitar processamento repetido.",
    "feature",
  ),
  milestone(
    "2026-08-20",
    "22ae1560",
    "Pedidos de compra no Omie",
    "integracao",
    "Integrações ERP",
    "Compras passaram a criar pedidos em empresas conectadas ao Omie.",
    "feature",
  ),
  milestone(
    "2026-08-21",
    "fb06d3a6",
    "Condições de pagamento nas compras",
    "funcao",
    "Compras e despesas",
    "Condição de pagamento por empresa incluída no pedido de compra.",
    "feature",
  ),
  milestone(
    "2026-08-21",
    "e3b9dcc9",
    "Rascunhos persistentes",
    "funcao",
    "Compras e despesas",
    "Rascunhos permanecem entre sessões até submissão ou exclusão.",
    "feature",
  ),
  milestone(
    "2026-08-21",
    "81bbe177",
    "IA do PagCorp com consumo controlado",
    "automacao",
    "PagCorp",
    "Análise limitada a anexos aprovados, não processados e não integrados.",
    "feature",
  ),
  milestone(
    "2026-08-21",
    "58680101",
    "Controles manuais de integração",
    "funcao",
    "Integrações ERP",
    "Ações idempotentes para disparar, repetir ou cancelar integrações.",
    "feature",
  ),
  milestone(
    "2026-08-25",
    "3493b7e6",
    "Reprocessamento de aprovação e Omie",
    "funcao",
    "Aprovações",
    "Novos controles de aprovação e ampliação das integrações de compra e venda.",
    "feature",
  ),
  milestone(
    "2026-08-25",
    "e83f1e18",
    "Perfil global do usuário",
    "melhoria",
    "Identidade",
    "Nome, e-mail e telefone compartilhados entre as empresas do usuário.",
    "feature",
  ),
  milestone(
    "2026-08-26",
    "8a6e2199",
    "Okta como provedor de identidade",
    "integracao",
    "Identidade",
    "Okta incluído em paralelo ao JumpCloud na gestão de identidades.",
    "feature",
  ),
  milestone(
    "2026-08-26",
    "8a6e2199",
    "Privacidade em aprovações rateadas",
    "seguranca",
    "Aprovações",
    "Cada ramo exibe apenas sua alçada e preserva decisões no reprocessamento.",
    "feature",
  ),
  milestone(
    "2026-08-26",
    "a652d685",
    "Sincronização de formas de pagamento",
    "automacao",
    "Cadastros compartilhados",
    "Formas de pagamento incluídas na replicação entre empresas.",
    "feature",
  ),
];

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const MONTH_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
});

function parseDate(date: string) {
  return new Date(`${date}T12:00:00`);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function BackofficeRoadmap() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ItemKind | "all">("all");
  const [track, setTrack] = useState("all");
  const [order, setOrder] = useState<"asc" | "desc">("asc");

  const tracks = useMemo(
    () =>
      [...new Set(CHANGELOG.map((item) => item.track))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [],
  );

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");

    return CHANGELOG.filter((item) => {
      const matchesKind = kind === "all" || item.kind === kind;
      const matchesTrack = track === "all" || item.track === track;
      const matchesSearch =
        !normalizedSearch ||
        [item.title, item.description, item.track, item.commit]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(normalizedSearch);

      return matchesKind && matchesTrack && matchesSearch;
    }).sort((a, b) => {
      const comparison = a.date.localeCompare(b.date);
      return order === "asc" ? comparison : -comparison;
    });
  }, [kind, order, search, track]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, RoadmapItem[]>();
    filteredItems.forEach((item) => {
      const key = item.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return [...groups.entries()];
  }, [filteredItems]);

  const firstDate = parseDate(CHANGELOG[0].date);
  const lastDate = parseDate(CHANGELOG[CHANGELOG.length - 1].date);
  const moduleCount = CHANGELOG.filter((item) => item.kind === "modulo").length;

  return (
    <div className="min-h-screen bg-background">
      <BackofficePageHeader
        title="Roadmap"
        description="História do produto reconstruída a partir dos commits do Git"
        icon={<History className="h-5 w-5" />}
      />

      <main className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
        <section
          className="grid overflow-hidden rounded-lg border bg-card md:grid-cols-3"
          aria-label="Resumo do histórico"
        >
          <div className="flex items-center gap-3 border-b p-4 md:border-b-0 md:border-r">
            <GitCommitHorizontal
              className="h-5 w-5 text-primary"
              aria-hidden="true"
            />
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {CHANGELOG.length}
              </p>
              <p className="text-sm text-muted-foreground">marcos funcionais</p>
            </div>
          </div>
          <div className="flex items-center gap-3 border-b p-4 md:border-b-0 md:border-r">
            <Boxes className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {moduleCount}
              </p>
              <p className="text-sm text-muted-foreground">
                módulos identificados
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-4">
            <CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" />
            <div>
              <p className="font-semibold">
                {DATE_FORMAT.format(firstDate)} a {DATE_FORMAT.format(lastDate)}
              </p>
              <p className="text-sm text-muted-foreground">
                período coberto pelo Git
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="history-title">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="history-title" className="text-xl font-semibold">
                Histórico de entregas
              </h2>
              <p className="text-sm text-muted-foreground">
                Cada marco aponta para o commit que introduziu o módulo ou
                registrou a evolução.
              </p>
            </div>
            <a
              href={`${REPOSITORY_URL}/commits/main`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              Ver histórico completo
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar entrega, área ou commit..."
                className="pl-9"
              />
            </div>

            <Select value={track} onValueChange={setTrack}>
              <SelectTrigger
                className="w-full lg:w-[230px]"
                aria-label="Filtrar por área"
              >
                <Tags
                  className="mr-2 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <SelectValue placeholder="Todas as áreas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as áreas</SelectItem>
                {tracks.map((trackName) => (
                  <SelectItem key={trackName} value={trackName}>
                    {trackName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              onClick={() =>
                setOrder((current) => (current === "asc" ? "desc" : "asc"))
              }
              className="justify-start lg:justify-center"
            >
              <ArrowDownUp className="mr-2 h-4 w-4" aria-hidden="true" />
              {order === "asc"
                ? "Mais antigos primeiro"
                : "Mais recentes primeiro"}
            </Button>
          </div>

          <div
            className="flex gap-2 overflow-x-auto pb-1"
            aria-label="Filtrar por natureza"
          >
            <Button
              size="sm"
              variant={kind === "all" ? "default" : "outline"}
              onClick={() => setKind("all")}
            >
              Todos
            </Button>
            {(
              Object.entries(KIND_META) as [
                ItemKind,
                (typeof KIND_META)[ItemKind],
              ][]
            ).map(([kindValue, meta]) => {
              const Icon = meta.icon;
              return (
                <Button
                  key={kindValue}
                  size="sm"
                  variant={kind === kindValue ? "default" : "outline"}
                  onClick={() => setKind(kindValue)}
                >
                  <Icon className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                  {meta.label}
                </Button>
              );
            })}
          </div>

          <p className="text-sm text-muted-foreground" role="status">
            {filteredItems.length}{" "}
            {filteredItems.length === 1
              ? "marco encontrado"
              : "marcos encontrados"}
          </p>

          {groupedItems.length > 0 ? (
            <div className="space-y-8">
              {groupedItems.map(([month, items]) => (
                <section
                  key={month}
                  className="grid gap-4 md:grid-cols-[150px_minmax(0,1fr)]"
                >
                  <div className="md:pt-1">
                    <h3 className="sticky top-4 font-semibold text-foreground">
                      {capitalize(
                        MONTH_FORMAT.format(parseDate(`${month}-01`)),
                      )}
                    </h3>
                  </div>

                  <div className="relative space-y-3 border-l pl-5 sm:pl-7">
                    {items.map((item) => {
                      const meta = KIND_META[item.kind];
                      const Icon = meta.icon;

                      return (
                        <article
                          key={`${item.commit}-${item.title}`}
                          className="relative rounded-lg border bg-card p-4 shadow-sm"
                        >
                          <span
                            className="absolute -left-[27px] top-6 h-3 w-3 rounded-full border-2 border-background bg-primary sm:-left-[35px]"
                            aria-hidden="true"
                          />

                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <time
                                  dateTime={item.date}
                                  className="text-xs font-medium uppercase text-muted-foreground"
                                >
                                  {DATE_FORMAT.format(parseDate(item.date))}
                                </time>
                                <Badge
                                  variant="outline"
                                  className={meta.className}
                                >
                                  <Icon
                                    className="mr-1 h-3 w-3"
                                    aria-hidden="true"
                                  />
                                  {meta.label}
                                </Badge>
                                <Badge variant="outline">{item.track}</Badge>
                              </div>
                              <h4 className="text-base font-semibold">
                                {item.title}
                              </h4>
                              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                                {item.description}
                              </p>
                            </div>

                            <a
                              href={`${REPOSITORY_URL}/commit/${item.commit}`}
                              target="_blank"
                              rel="noreferrer"
                              title={`Abrir commit ${item.commit} no GitHub`}
                              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
                            >
                              <GitCommitHorizontal
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                              {item.commit}
                              <ExternalLink
                                className="h-3 w-3"
                                aria-hidden="true"
                              />
                            </a>
                          </div>

                          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                            {EVIDENCE_LABEL[item.evidence]}
                          </p>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed py-16 text-center">
              <Search
                className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="font-medium">Nenhum marco encontrado</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Ajuste a busca ou remova algum filtro.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

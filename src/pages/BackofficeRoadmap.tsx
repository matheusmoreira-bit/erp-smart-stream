import { useMemo, useState } from "react";
import {
  Rocket,
  Boxes,
  Plug,
  Bot,
  Sparkles,
  ShieldCheck,
  Search,
  Lightbulb,
  CircleDot,
} from "lucide-react";
import { BackofficePageHeader } from "@/components/BackofficePageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Roadmap do ERP Flow: linha do tempo vertical com tudo que já foi entregue
 * (módulos, funções, melhorias, integrações e automações) e, abaixo,
 * a lista de sugestões de backlog.
 */

type ItemKind = "modulo" | "funcao" | "melhoria" | "integracao" | "automacao" | "seguranca";

const KIND_META: Record<ItemKind, { label: string; icon: typeof Boxes; className: string }> = {
  modulo: { label: "Módulo", icon: Boxes, className: "bg-primary/15 text-primary border-primary/30" },
  funcao: { label: "Função", icon: Sparkles, className: "bg-accent/40 text-accent-foreground border-border" },
  melhoria: { label: "Melhoria", icon: Rocket, className: "bg-muted text-muted-foreground border-border" },
  integracao: { label: "Integração", icon: Plug, className: "bg-secondary text-secondary-foreground border-border" },
  automacao: { label: "Automação", icon: Bot, className: "bg-muted text-foreground border-border" },
  seguranca: { label: "Segurança", icon: ShieldCheck, className: "bg-destructive/10 text-destructive border-destructive/30" },
};

interface RoadmapItem {
  title: string;
  kind: ItemKind;
  description: string;
}

interface RoadmapPhase {
  period: string;
  headline: string;
  items: RoadmapItem[];
}

const TIMELINE: RoadmapPhase[] = [
  {
    period: "Fase 1 — Fundação",
    headline: "Base do ERP Flow, autenticação e cadastro de empresas",
    items: [
      {
        title: "Multiempresa com login SAP B1",
        kind: "modulo",
        description:
          "Seleção de CompanyDB, sessão SAP com renovação automática (keep-alive de 5 min) e troca de empresa sem novo login.",
      },
      {
        title: "Login Google + vínculo de identidade",
        kind: "funcao",
        description:
          "Gate de autenticação Google, resolução flexível de identidades (sufixos .ext, acentos e domínios) e correção de loops de login.",
      },
      {
        title: "Backoffice administrativo",
        kind: "modulo",
        description:
          "Cadastro de empresas, usuários, provisionamento de acesso SAP e reset de senha com política de senha nunca expira.",
      },
    ],
  },
  {
    period: "Fase 2 — Compras e aprovações",
    headline: "Ciclo completo de pedidos de compra e alçadas",
    items: [
      {
        title: "Pedido de compras e rateio",
        kind: "modulo",
        description:
          "Formulário com itens, centro de custo, projeto, tipos de rateio e anexos com upload resiliente (retry exponencial).",
      },
      {
        title: "Motor de regras de aprovação",
        kind: "funcao",
        description:
          "Regras por CC, projeto, faixa de valor, item e fluxo; níveis AP1..AP4 com aprovadores paralelos.",
      },
      {
        title: "Aprovações pendentes e histórico",
        kind: "modulo",
        description:
          "Ordenação por vencimento, KPIs clicáveis, filtros buscáveis, máscara de segmentos de outros aprovadores em rateios.",
      },
      {
        title: "Integração SAP B1 (Service Layer)",
        kind: "integracao",
        description:
          "Envio de PurchaseOrders, anexos com CopyToTargetDocument, fallback de projeto \"ANA GAMING\" e tratamento de timeout (504 amigável).",
      },
      {
        title: "Raio-X da regra",
        kind: "funcao",
        description:
          "Diagnóstico que explica qual regra foi aplicada e por quê, comparando CC + projeto + valor + item + rateio.",
      },
    ],
  },
  {
    period: "Fase 3 — Vendas e fiscal",
    headline: "Pedido de venda, NFS-e e contas a receber",
    items: [
      {
        title: "Módulo de vendas em três frentes",
        kind: "modulo",
        description:
          "Pedidos de venda, NFS-e e contas a receber, com guard de rotas e limpeza de cache local no logout.",
      },
      {
        title: "Baixa de recebimento no SAP",
        kind: "integracao",
        description:
          "Modal de confirmação, filial (BPLID) obtida da nota de origem, mapa de relações baixa a baixa com saldo residual e saldos iniciais (SI).",
      },
      {
        title: "NFS-e: PDF, XML e envio por e-mail",
        kind: "automacao",
        description:
          "Busca do PDF na prefeitura, view VW_NFSE_XML_AUTORIZADO e disparo de e-mail por mapeamento Cliente|Projeto.",
      },
      {
        title: "Auditoria fiscal cruzada",
        kind: "funcao",
        description:
          "Kanban de conciliação entre pagamentos, notas capturadas pelo Master Tax e documentos do ERP.",
      },
      {
        title: "Notificações do ciclo de vendas",
        kind: "automacao",
        description:
          "Alertas em aprovação pendente, aprovação realizada, NFS-e emitida, envio ao cliente e baixa.",
      },
    ],
  },
  {
    period: "Fase 4 — Integrações e dados",
    headline: "HanaAPI, PagCorp, JumpCloud e KYP",
    items: [
      {
        title: "HanaAPI V2 com fallback de IP",
        kind: "integracao",
        description:
          "Token dinâmico HMAC-SHA256, views VW_FORNECEDORES e VW_ACOMPANHAMENTO_PEDIDOS, com fallback para Service Layer.",
      },
      {
        title: "Integração PagCorp",
        kind: "integracao",
        description:
          "Importação de despesas de cartão com anexos obrigatórios e auditoria de baixas indevidas.",
      },
      {
        title: "API pública de status PagCorp",
        kind: "integracao",
        description:
          "Edge function com autenticação x-api-key, spec OpenAPI 3.1 e Swagger UI para consumo por outros projetos.",
      },
      {
        title: "JumpCloud → SAP B1 (colaboradores)",
        kind: "automacao",
        description: "Sincronização agendada por cron, restrita às bases TST% durante a homologação.",
      },
      {
        title: "Módulo KYP (diligência de fornecedores)",
        kind: "modulo",
        description:
          "Orquestrador com adapter agnóstico de provedor (BeCompliance) e tela de auditoria KYP.",
      },
      {
        title: "Solicitações de cadastro (chamados)",
        kind: "modulo",
        description:
          "Fila do time de Facilities, SLA de 48h úteis, anexos privados e notificação ao solicitante na conclusão.",
      },
    ],
  },
  {
    period: "Fase 5 — Governança e segurança",
    headline: "Permissões, visibilidade e tratativa de pentest",
    items: [
      {
        title: "Grupos de permissão V2",
        kind: "funcao",
        description:
          "Permissões funcionais por grupo, capability de empresas teste (TST%) e overrides globais de itens (FOL%/IMP%).",
      },
      {
        title: "Regra de visibilidade de documentos",
        kind: "funcao",
        description:
          "Usuário vê o que criou ou aprova; admin com toggle \"Ver todos\" ligado por padrão, também nas linhas vindas da HanaAPI.",
      },
      {
        title: "Restrição inteligente de centro de custo",
        kind: "melhoria",
        description:
          "Usuário lança em qualquer CC do mesmo prefixo de 2º nível, salvo grupos privilegiados com visão total.",
      },
      {
        title: "Tratativa do pentest whitebox",
        kind: "seguranca",
        description:
          "Leituras escopadas no servidor, senha mínima de 12 caracteres, idempotência atômica, CSP/HSTS e tokens anti-CSRF.",
      },
      {
        title: "Alerta CC × Projeto auditável",
        kind: "automacao",
        description:
          "Confirmação obrigatória em combinações sensíveis, com trilha de auditoria, apenas em empresas multiprojeto.",
      },
    ],
  },
  {
    period: "Fase 6 — Experiência e inteligência",
    headline: "Novo layout, copiloto e visão em teia",
    items: [
      {
        title: "Nova navegação e cabeçalhos padronizados",
        kind: "melhoria",
        description:
          "Menu superior com logo, empresa/usuário em dropdown, submenus em modal, breadcrumbs abaixo da logo e wizard de novidades.",
      },
      {
        title: "Copiloto IA do backoffice",
        kind: "funcao",
        description:
          "Chat com streaming, cadeia de modelos com fallback, execução de ferramentas e leitura de schema para SQL preciso.",
      },
      {
        title: "Matriz de alçadas em teia",
        kind: "funcao",
        description:
          "Mapa mental radial com painel lateral, persistência de zoom/recolhimento, otimizações de renderização e filtros/busca internos.",
      },
      {
        title: "Padronização de exibição de usuários",
        kind: "melhoria",
        description: "Nome do colaborador em vez de e-mail em todas as telas de aprovação e histórico.",
      },
      {
        title: "Retries com fallback de anexo",
        kind: "automacao",
        description:
          "Reintegração sem anexo e envio do documento por e-mail para fiscal@{domínio da empresa}.",
      },
    ],
  },
];

interface BacklogItem {
  title: string;
  impact: "alto" | "médio" | "baixo";
  effort: "alto" | "médio" | "baixo";
  description: string;
}

const BACKLOG: { group: string; items: BacklogItem[] }[] = [
  {
    group: "Confiabilidade das integrações",
    items: [
      {
        title: "Painel único de saúde das integrações",
        impact: "alto",
        effort: "médio",
        description:
          "Consolidar SAP Service Layer, HanaAPI V2, PagCorp e Master Tax em um só painel com latência, taxa de erro e última execução.",
      },
      {
        title: "Fila de retentativa automática com backoff",
        impact: "alto",
        effort: "médio",
        description:
          "Reprocessar automaticamente falhas transitórias (timeout/sessão) sem intervenção manual, com limite e alerta ao falhar de vez.",
      },
      {
        title: "Circuit breaker por empresa",
        impact: "médio",
        effort: "baixo",
        description:
          "Interromper chamadas a uma base indisponível por alguns minutos para não travar as demais rotinas.",
      },
    ],
  },
  {
    group: "Aprovações e governança",
    items: [
      {
        title: "Simulador de regras antes de publicar",
        impact: "alto",
        effort: "médio",
        description:
          "Rodar um documento fictício contra a matriz e mostrar a cadeia resultante antes de salvar alterações.",
      },
      {
        title: "Detecção de conflitos e sobreposição de regras",
        impact: "médio",
        effort: "médio",
        description:
          "Alertar quando duas regras ativas competirem pelo mesmo cenário, aproveitando a lógica do Raio-X.",
      },
      {
        title: "Delegação temporária de alçada (férias)",
        impact: "alto",
        effort: "médio",
        description: "Substituto com vigência definida e registro em audit log, evitando documentos parados.",
      },
      {
        title: "Aprovação por e-mail e mobile-first",
        impact: "médio",
        effort: "alto",
        description: "Aprovar/reprovar com link assinado de uso único, sem abrir o sistema.",
      },
    ],
  },
  {
    group: "Dados e analytics",
    items: [
      {
        title: "Dashboard de SLA de aprovação",
        impact: "alto",
        effort: "médio",
        description: "Tempo médio por aprovador, gargalos por CC/projeto e ranking de atrasos.",
      },
      {
        title: "Exportações agendadas",
        impact: "baixo",
        effort: "baixo",
        description: "Envio recorrente de relatórios (compras, vendas, fiscal) por e-mail em CSV/XLSX.",
      },
      {
        title: "Conciliação fiscal automática",
        impact: "alto",
        effort: "alto",
        description:
          "Casar automaticamente NFS-e, pagamento e lançamento no ERP, deixando no Kanban só as exceções.",
      },
    ],
  },
  {
    group: "Segurança e conformidade",
    items: [
      {
        title: "SSO corporativo (Okta/OIDC) com MFA",
        impact: "alto",
        effort: "alto",
        description: "Substituir o login local por identidade corporativa, com MFA obrigatório.",
      },
      {
        title: "Revisão periódica de acessos",
        impact: "médio",
        effort: "médio",
        description: "Campanha trimestral de recertificação de grupos e alçadas, com evidência para auditoria.",
      },
      {
        title: "Trilha de auditoria unificada e pesquisável",
        impact: "médio",
        effort: "médio",
        description: "Uma única linha do tempo por documento, reunindo eventos de ERP, SAP e integrações.",
      },
    ],
  },
  {
    group: "Experiência do usuário",
    items: [
      {
        title: "Notificações in-app com central de avisos",
        impact: "médio",
        effort: "médio",
        description: "Complementar o e-mail com um sino de notificações e histórico dos marcos do documento.",
      },
      {
        title: "Rascunhos e duplicação de pedidos",
        impact: "médio",
        effort: "baixo",
        description: "Salvar em andamento e criar um novo pedido a partir de outro já lançado.",
      },
      {
        title: "Onboarding guiado por perfil",
        impact: "baixo",
        effort: "baixo",
        description: "Tour curto no primeiro acesso, adaptado ao grupo de permissão do usuário.",
      },
    ],
  },
];

const IMPACT_CLASS: Record<BacklogItem["impact"], string> = {
  alto: "border-primary/40 text-primary",
  médio: "border-border text-muted-foreground",
  baixo: "border-border text-muted-foreground",
};

export default function BackofficeRoadmap() {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | ItemKind>("all");

  const phases = useMemo(() => {
    const term = search.trim().toLowerCase();
    return TIMELINE.map((phase) => ({
      ...phase,
      items: phase.items.filter((item) => {
        if (kind !== "all" && item.kind !== kind) return false;
        if (!term) return true;
        return (
          item.title.toLowerCase().includes(term) ||
          item.description.toLowerCase().includes(term) ||
          phase.period.toLowerCase().includes(term)
        );
      }),
    })).filter((phase) => phase.items.length > 0);
  }, [search, kind]);

  const total = TIMELINE.reduce((acc, p) => acc + p.items.length, 0);
  const shown = phases.reduce((acc, p) => acc + p.items.length, 0);

  return (
    <div className="min-h-screen bg-background px-6 pb-16">
      <BackofficePageHeader
        title="Roadmap"
        description="Linha do tempo das entregas e sugestões de backlog"
        icon={<Rocket className="h-5 w-5 text-primary" />}
      />

      <main className="mx-auto max-w-5xl py-6">
        {/* Filtros */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar entrega, módulo ou integração..."
              className="h-9 pl-8"
              aria-label="Buscar no roadmap"
            />
          </div>
          <Button
            size="sm"
            variant={kind === "all" ? "default" : "outline"}
            onClick={() => setKind("all")}
          >
            Tudo
          </Button>
          {(Object.keys(KIND_META) as ItemKind[]).map((k) => {
            const Icon = KIND_META[k].icon;
            return (
              <Button
                key={k}
                size="sm"
                variant={kind === k ? "default" : "outline"}
                onClick={() => setKind(k)}
              >
                <Icon className="mr-1 h-3.5 w-3.5" />
                {KIND_META[k].label}
              </Button>
            );
          })}
          <Badge variant="secondary" className="h-7">
            {shown} de {total} entregas
          </Badge>
        </div>

        {/* Timeline vertical */}
        <section aria-label="Linha do tempo de entregas">
          {phases.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma entrega corresponde aos filtros.
            </p>
          )}

          <ol className="relative ml-3 border-l border-border pl-6">
            {phases.map((phase) => (
              <li key={phase.period} className="mb-10">
                <span className="absolute -left-[9px] mt-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-primary/40 bg-primary/20">
                  <CircleDot className="h-3 w-3 text-primary" />
                </span>
                <h2 className="text-base font-semibold text-foreground">{phase.period}</h2>
                <p className="mb-3 text-xs text-muted-foreground">{phase.headline}</p>

                <div className="space-y-3">
                  {phase.items.map((item) => {
                    const meta = KIND_META[item.kind];
                    const Icon = meta.icon;
                    return (
                      <Card key={item.title} className="border-border/70">
                        <CardContent className="flex gap-3 p-4">
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                            <Icon className="h-4 w-4 text-muted-foreground" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                              <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                                {meta.label}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Backlog */}
        <section aria-label="Sugestões de backlog" className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-[hsl(var(--cactus-amber))]" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Sugestões de backlog</h2>
              <p className="text-xs text-muted-foreground">
                Pendências e melhorias propostas — ainda não implementadas.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {BACKLOG.map((group) => (
              <Card key={group.group}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{group.group}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.items.map((item) => (
                    <div key={item.title} className="rounded-md border border-border/70 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                        <Badge variant="outline" className={`text-[10px] ${IMPACT_CLASS[item.impact]}`}>
                          Impacto {item.impact}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          Esforço {item.effort}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

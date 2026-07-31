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
  ArrowUpDown,

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
  /** Data da entrega (ISO, YYYY-MM-DD). */
  date: string;
  title: string;
  kind: ItemKind;
  /** Grupo/fase apenas como referência — não agrupa a lista. */
  track: string;
  description: string;
}

/** Changelog: uma lista única, em ordem cronológica (mais recente primeiro). */
const CHANGELOG: RoadmapItem[] = [
  // ---- Fase 6 — Experiência e inteligência (jul/2026)
  {
    date: "2026-07-30",
    title: "Escalonamento automático por SLA",
    kind: "funcao",
    track: "Aprovações",
    description:
      "Documento parado além do prazo (horas úteis, configurável por empresa) sobe automaticamente para o substituto vigente ou para o nível superior da matriz, com e-mail de contingência, notificação ao novo aprovador, limite de escalonamentos e registro em audit log.",
  },
  {
    date: "2026-07-30",
    title: "Versionamento e rollback da matriz de alçadas",
    kind: "funcao",
    track: "Governança e segurança",
    description:
      "Cada publicação da matriz é congelada em uma versão (regras, critérios e aprovadores), com comparação lado a lado entre versões (ou contra o estado atual) e rollback para um estado anterior, gerando backup automático e registro em audit log.",
  },
  {

    date: "2026-07-30",
    title: "Captura de nota por foto/OCR (celular)",
    kind: "modulo",
    track: "Experiência e inteligência",
    description:
      "No celular, o usuário fotografa a nota/boleto e a IA (server-side) pré-preenche fornecedor, CNPJ, valor, nº do documento e vencimento para conferência antes de abrir o lançamento com o arquivo já anexado.",
  },
  {
    date: "2026-07-30",
    title: "App mobile-first para aprovações (PWA)",
    kind: "modulo",
    track: "Experiência e inteligência",
    description:
      "Aplicativo instalável no celular (Adicionar à tela de início) com tela dedicada de aprovações: aprovar/reprovar com justificativa, consultar status e anexar comprovante direto pela câmera.",
  },
  {
    date: "2026-07-30",
    title: "Revisão periódica de acessos",
    kind: "seguranca",
    track: "Governança e segurança",
    description:
      "Campanhas trimestrais de recertificação: retrato automático de grupos e alçadas, decisão de manter/alterar/revogar com justificativa, revogação aplicada na hora e exportação de evidência para auditoria.",
  },
  {
    date: "2026-07-30",
    title: "Identidade canônica do usuário SAP",
    kind: "melhoria",
    track: "Governança e segurança",
    description:
      "Usuário SAP como chave única (1:N e-mails, 1:1 nome), unificação de duplicidades por similaridade de grafia e consolidação mantendo o grupo de maior permissão em todas as bases.",
  },
  {
    date: "2026-07-30",
    title: "Central de notificações configurável",
    kind: "funcao",
    track: "Experiência e inteligência",
    description:
      "Histórico único de todos os envios (in-app, e-mail, WhatsApp e rotinas) e edição de gatilhos, frequência, canais e templates pelos administradores.",
  },
  {
    date: "2026-07-30",
    title: "Módulo de usuários unificado",
    kind: "modulo",
    track: "Governança e segurança",
    description:
      "Hub único com lista de pessoas, grupos, capabilities e sincronização de IdP, substituindo as telas separadas de permissões e usuários SAP.",
  },
  {
    date: "2026-07-30",
    title: "Permissões por capability (GRUPO > USER)",
    kind: "funcao",
    track: "Governança e segurança",
    description:
      "Catálogo central de flags por grupo (ver todos, cadastro direto de fornecedor, empresas teste etc.), sem exceções escondidas no usuário.",
  },
  {
    date: "2026-07-30",
    title: "Onboarding guiado por perfil",
    kind: "melhoria",
    track: "Experiência e inteligência",
    description:
      "Tour curto no primeiro acesso, adaptado ao grupo de permissão, com opção de reexibir pelo menu do usuário.",
  },
  {
    date: "2026-07-30",
    title: "Trilha de auditoria unificada por documento",
    kind: "funcao",
    track: "Governança e segurança",
    description:
      "Linha do tempo pesquisável reunindo eventos de ERP, aprovações, retries do SAP e notificações.",
  },
  {
    date: "2026-07-30",
    title: "Painel único de saúde das integrações",
    kind: "funcao",
    track: "Integrações e dados",
    description:
      "SAP Service Layer, HanaAPI V2, PagCorp e Master Tax em um só painel, com latência, taxa de erro e última execução.",
  },
  {
    date: "2026-07-30",
    title: "Fila de retentativa automática com backoff",
    kind: "automacao",
    track: "Integrações e dados",
    description:
      "Reprocessamento de falhas transitórias com backoff progressivo, jitter e recuperação de itens travados. Falhas de anexo não são integradas automaticamente sem anexo — exigem decisão manual.",
  },
  {
    date: "2026-07-30",
    title: "Circuit breaker por empresa",
    kind: "automacao",
    track: "Integrações e dados",
    description:
      "Base indisponível deixa de ser chamada por alguns minutos após falhas seguidas, sem travar as demais rotinas.",
  },
  {
    date: "2026-07-30",
    title: "Detecção de conflitos entre regras de aprovação",
    kind: "funcao",
    track: "Compras e aprovações",
    description:
      "Alerta de empates de prioridade, sobreposição e regras sombreadas, aproveitando a lógica do Raio-X.",
  },
  {
    date: "2026-07-30",
    title: "Simulador de regras antes de publicar",
    kind: "funcao",
    track: "Compras e aprovações",
    description:
      "Documento fictício rodado contra a matriz mostra a cadeia de aprovação resultante antes de salvar alterações.",
  },
  {
    date: "2026-07-30",
    title: "Delegação temporária de alçada (férias)",
    kind: "funcao",
    track: "Compras e aprovações",
    description:
      "Substituto com vigência definida e registro em audit log, evitando documentos parados.",
  },
  {
    date: "2026-07-30",
    title: "Aprovação por e-mail, mobile e Slack",
    kind: "funcao",
    track: "Compras e aprovações",
    description:
      "Link assinado de uso único em /aprovar/:token, com orquestração multicanal preparada para Slack.",
  },
  {
    date: "2026-07-30",
    title: "Rascunhos, duplicação e reativação de pedidos",
    kind: "melhoria",
    track: "Compras e aprovações",
    description:
      "Salvar em andamento, criar pedido a partir de outro já lançado e reativar documentos cancelados pelo autor.",
  },
  {
    date: "2026-07-30",
    title: "Esboço de NF de entrada no ERP",
    kind: "integracao",
    track: "Integrações e dados",
    description:
      "Lançamento de rascunho no SAP B1 quando o documento capturado pelo Master Tax tem pedido vinculado sem NF de entrada.",
  },

  {
    date: "2026-07-30",
    title: "Relançamento de documentos cancelados",
    kind: "melhoria",
    track: "Compras e aprovações",
    description:
      "Exceção na deduplicação de anexos: notas cujo lançamento foi cancelado podem ser lançadas novamente; duplicatas ativas seguem bloqueadas.",
  },
  {
    date: "2026-07-30",
    title: "Troca de grupo do usuário na lista da empresa",
    kind: "funcao",
    track: "Governança e segurança",
    description:
      "Atribuição de grupo de permissão direto na tela de usuários, com efeito global (todas as empresas), sem passar pelo backoffice.",
  },
  {
    date: "2026-07-30",
    title: "Usuário Administrativo com visão total de centros de custo",
    kind: "melhoria",
    track: "Governança e segurança",
    description:
      "O grupo passa a selecionar qualquer CC ao criar pedidos, mantendo a visibilidade de documentos restrita à própria diretoria.",
  },
  {
    date: "2026-07-29",
    title: "Matriz de alçadas em teia",
    kind: "funcao",
    track: "Experiência e inteligência",
    description:
      "Mapa mental radial com painel lateral, persistência de zoom/recolhimento, otimizações de renderização e filtros/busca internos.",
  },
  {
    date: "2026-07-28",
    title: "Raio-X da regra de aprovação",
    kind: "funcao",
    track: "Compras e aprovações",
    description:
      "Diagnóstico que explica qual regra foi aplicada e por quê, comparando CC + projeto + valor + item + rateio.",
  },
  {
    date: "2026-07-26",
    title: "Sanitização da base de regras de aprovação",
    kind: "melhoria",
    track: "Governança e segurança",
    description:
      "Remoção de 122 regras inativas/duplicadas, preservando as que possuem vínculo histórico para auditoria.",
  },
  {
    date: "2026-07-24",
    title: "Copiloto IA do backoffice",
    kind: "funcao",
    track: "Experiência e inteligência",
    description:
      "Chat com streaming, cadeia de modelos com fallback, execução de ferramentas e leitura de schema para SQL preciso.",
  },
  {
    date: "2026-07-22",
    title: "Padronização de exibição de usuários",
    kind: "melhoria",
    track: "Experiência e inteligência",
    description: "Nome do colaborador em vez de e-mail em todas as telas de aprovação e histórico.",
  },
  {
    date: "2026-07-18",
    title: "Nova navegação e cabeçalhos padronizados",
    kind: "melhoria",
    track: "Experiência e inteligência",
    description:
      "Menu superior com logo, empresa/usuário em dropdown, submenus em modal, breadcrumbs abaixo da logo e wizard de novidades.",
  },
  {
    date: "2026-07-15",
    title: "Ocultação de empresas de teste (TST%)",
    kind: "seguranca",
    track: "Governança e segurança",
    description:
      "Bases de homologação visíveis apenas para admins ou grupos com a capability específica, em login e seletor de empresa.",
  },
  {
    date: "2026-07-12",
    title: "Retries com fallback de anexo",
    kind: "automacao",
    track: "Integrações e dados",
    description:
      "Reintegração sem anexo e envio do documento por e-mail para fiscal@{domínio da empresa}.",
  },
  {
    date: "2026-07-30",
    title: "Modo offline com fila de envio",
    kind: "funcao",
    track: "Integrações e dados",
    description:
      "Pedidos e despesas podem ser lançados com a base do ERP fora do ar: o envio fica em fila local e é reprocessado quando o circuit breaker fecha.",
  },
  // ---- Fase 5 — Governança e segurança (jun–jul/2026)
  {
    date: "2026-07-29",
    title: "Tratativa do pentest whitebox",
    kind: "seguranca",
    track: "Governança e segurança",
    description:
      "Leituras escopadas no servidor, senha mínima de 12 caracteres, idempotência atômica, CSP/HSTS e tokens anti-CSRF.",
  },
  {
    date: "2026-07-29",
    title: "Alerta CC × Projeto auditável",
    kind: "automacao",
    track: "Governança e segurança",
    description:
      "Confirmação obrigatória em combinações sensíveis, com trilha de auditoria, apenas em empresas multiprojeto.",
  },
  {
    date: "2026-06-22",
    title: "Restrição inteligente de centro de custo",
    kind: "melhoria",
    track: "Governança e segurança",
    description:
      "Usuário lança em qualquer CC do mesmo prefixo de 2º nível, salvo grupos privilegiados com visão total.",
  },
  {
    date: "2026-06-15",
    title: "Regra de visibilidade de documentos",
    kind: "funcao",
    track: "Governança e segurança",
    description:
      "Usuário vê o que criou ou aprova; admin com toggle \"Ver todos\" ligado por padrão, também nas linhas vindas da HanaAPI.",
  },
  {
    date: "2026-06-08",
    title: "Grupos de permissão V2",
    kind: "funcao",
    track: "Governança e segurança",
    description:
      "Permissões funcionais por grupo, capability de empresas teste (TST%) e overrides globais de itens (FOL%/IMP%).",
  },
  // ---- Fase 4 — Integrações e dados (mai–jun/2026)
  {
    date: "2026-06-02",
    title: "API pública de status PagCorp",
    kind: "integracao",
    track: "Integrações e dados",
    description:
      "Edge function com autenticação x-api-key, spec OpenAPI 3.1 e Swagger UI para consumo por outros projetos.",
  },
  {
    date: "2026-05-28",
    title: "Módulo KYP (diligência de fornecedores)",
    kind: "modulo",
    track: "Integrações e dados",
    description:
      "Orquestrador com adapter agnóstico de provedor (BeCompliance) e tela de auditoria KYP.",
  },
  {
    date: "2026-05-20",
    title: "Solicitações de cadastro (chamados)",
    kind: "modulo",
    track: "Integrações e dados",
    description:
      "Fila do time de Facilities, SLA de 48h úteis, anexos privados e notificação ao solicitante na conclusão.",
  },
  {
    date: "2026-05-14",
    title: "JumpCloud → SAP B1 (colaboradores)",
    kind: "automacao",
    track: "Integrações e dados",
    description: "Sincronização agendada por cron, restrita às bases TST% durante a homologação.",
  },
  {
    date: "2026-05-08",
    title: "HanaAPI V2 com fallback de IP",
    kind: "integracao",
    track: "Integrações e dados",
    description:
      "Token dinâmico HMAC-SHA256, views VW_FORNECEDORES e VW_ACOMPANHAMENTO_PEDIDOS, com fallback para Service Layer.",
  },
  {
    date: "2026-05-02",
    title: "Integração PagCorp",
    kind: "integracao",
    track: "Integrações e dados",
    description:
      "Importação de despesas de cartão com anexos obrigatórios e auditoria de baixas indevidas.",
  },
  // ---- Fase 3 — Vendas e fiscal (abr–mai/2026)
  {
    date: "2026-04-26",
    title: "Notificações do ciclo de vendas",
    kind: "automacao",
    track: "Vendas e fiscal",
    description:
      "Alertas em aprovação pendente, aprovação realizada, NFS-e emitida, envio ao cliente e baixa.",
  },
  {
    date: "2026-04-20",
    title: "Auditoria fiscal cruzada",
    kind: "funcao",
    track: "Vendas e fiscal",
    description:
      "Kanban de conciliação entre pagamentos, notas capturadas pelo Master Tax e documentos do ERP.",
  },
  {
    date: "2026-04-14",
    title: "NFS-e: PDF, XML e envio por e-mail",
    kind: "automacao",
    track: "Vendas e fiscal",
    description:
      "Busca do PDF na prefeitura, view VW_NFSE_XML_AUTORIZADO e disparo de e-mail por mapeamento Cliente|Projeto.",
  },
  {
    date: "2026-04-08",
    title: "Baixa de recebimento no SAP",
    kind: "integracao",
    track: "Vendas e fiscal",
    description:
      "Modal de confirmação, filial (BPLID) obtida da nota de origem, mapa de relações baixa a baixa com saldo residual e saldos iniciais (SI).",
  },
  {
    date: "2026-04-01",
    title: "Módulo de vendas em três frentes",
    kind: "modulo",
    track: "Vendas e fiscal",
    description:
      "Pedidos de venda, NFS-e e contas a receber, com guard de rotas e limpeza de cache local no logout.",
  },
  // ---- Fase 2 — Compras e aprovações (mar/2026)
  {
    date: "2026-03-24",
    title: "Integração SAP B1 (Service Layer)",
    kind: "integracao",
    track: "Compras e aprovações",
    description:
      "Envio de PurchaseOrders, anexos com CopyToTargetDocument, fallback de projeto \"ANA GAMING\" e tratamento de timeout (504 amigável).",
  },
  {
    date: "2026-03-16",
    title: "Aprovações pendentes e histórico",
    kind: "modulo",
    track: "Compras e aprovações",
    description:
      "Ordenação por vencimento, KPIs clicáveis, filtros buscáveis, máscara de segmentos de outros aprovadores em rateios.",
  },
  {
    date: "2026-03-09",
    title: "Motor de regras de aprovação",
    kind: "funcao",
    track: "Compras e aprovações",
    description:
      "Regras por CC, projeto, faixa de valor, item e fluxo; níveis AP1..AP4 com aprovadores paralelos.",
  },
  {
    date: "2026-03-02",
    title: "Pedido de compras e rateio",
    kind: "modulo",
    track: "Compras e aprovações",
    description:
      "Formulário com itens, centro de custo, projeto, tipos de rateio e anexos com upload resiliente (retry exponencial).",
  },
  // ---- Fase 1 — Fundação (jan–fev/2026)
  {
    date: "2026-02-18",
    title: "Backoffice administrativo",
    kind: "modulo",
    track: "Fundação",
    description:
      "Cadastro de empresas, usuários, provisionamento de acesso SAP e reset de senha com política de senha nunca expira.",
  },
  {
    date: "2026-02-05",
    title: "Login Google + vínculo de identidade",
    kind: "funcao",
    track: "Fundação",
    description:
      "Gate de autenticação Google, resolução flexível de identidades (sufixos .ext, acentos e domínios) e correção de loops de login.",
  },
  {
    date: "2026-01-22",
    title: "Multiempresa com login SAP B1",
    kind: "modulo",
    track: "Fundação",
    description:
      "Seleção de CompanyDB, sessão SAP com renovação automática (keep-alive de 5 min) e troca de empresa sem novo login.",
  },
];

const DATE_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const MONTH_FMT = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(iso: string) {
  return DATE_FMT.format(new Date(`${iso}T00:00:00Z`));
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function formatMonth(iso: string) {
  const label = MONTH_FMT.format(new Date(`${iso}T00:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}


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
        title: "Alertas proativos de degradação",
        impact: "alto",
        effort: "baixo",
        description:
          "Disparar aviso (e-mail/Slack) quando o painel de saúde detectar latência ou taxa de erro acima do limite, sem depender de alguém abrir a tela.",
      },
      {
        title: "Contrato de dados das views HanaAPI",
        impact: "médio",
        effort: "médio",
        description:
          "Validar schema das views (VW_FORNECEDORES, VW_ACOMPANHAMENTO_PEDIDOS) a cada execução e alertar mudanças antes de quebrar telas.",
      },
    ],
  },
  {
    group: "Aprovações e governança",
    items: [
      {
        title: "Dashboard de SLA de aprovação",
        impact: "alto",
        effort: "médio",
        description: "Tempo médio por aprovador, gargalos por CC/projeto e ranking de atrasos.",
      },
      {
        title: "Escalonamento automático por SLA",
        impact: "alto",
        effort: "médio",
        description:
          "Documento parado além do prazo sobe automaticamente para o superior ou para o substituto vigente, com registro em auditoria.",
      },
      {
        title: "Versionamento e rollback da matriz de alçadas",
        impact: "médio",
        effort: "médio",
        description:
          "Guardar cada publicação da matriz, comparar versões e permitir voltar a um estado anterior.",
      },
      {
        title: "Aprovação em lote com filtros salvos",
        impact: "médio",
        effort: "baixo",
        description:
          "Selecionar vários documentos do mesmo CC/projeto e aprovar de uma vez, respeitando o mascaramento de rateios.",
      },
    ],
  },
  {
    group: "Dados e analytics",
    items: [
      {
        title: "Conciliação fiscal automática",
        impact: "alto",
        effort: "alto",
        description:
          "Casar automaticamente NFS-e, pagamento e lançamento no ERP, deixando no Kanban só as exceções.",
      },
      {
        title: "Exportações agendadas",
        impact: "baixo",
        effort: "baixo",
        description: "Envio recorrente de relatórios (compras, vendas, fiscal) por e-mail em CSV/XLSX.",
      },
      {
        title: "Previsão de caixa por vencimento",
        impact: "médio",
        effort: "médio",
        description:
          "Consolidar contas a pagar e a receber com projeções por CC/projeto e comparação com o realizado.",
      },
      {
        title: "Copiloto com relatórios salvos",
        impact: "médio",
        effort: "baixo",
        description:
          "Permitir salvar e reexecutar consultas do copiloto do backoffice como relatórios nomeados, com controle por grupo.",
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
        title: "Desprovisionamento automático via IdP",
        impact: "alto",
        effort: "médio",
        description:
          "Desligamento no JumpCloud/Okta revoga acessos, alçadas e substituições vigentes na mesma sincronização.",
      },
      {
        title: "Retenção e mascaramento de dados sensíveis",
        impact: "médio",
        effort: "médio",
        description:
          "Política de expurgo de anexos e mascaramento de dados bancários/PII fora do grupo responsável.",
      },
    ],
  },
  {
    group: "Experiência do usuário",
    items: [
      {
        title: "Push nativo nas aprovações (Web Push/FCM)",
        impact: "médio",
        effort: "médio",
        description:
          "Complemento do PWA: notificação push no celular ao surgir uma aprovação pendente (requer credenciais de mensageria).",
      },
      {
        title: "Busca global (documentos, fornecedores, pessoas)",
        impact: "médio",
        effort: "médio",
        description:
          "Campo único com atalho de teclado, retornando documentos, fornecedores e usuários respeitando as capabilities do grupo.",
      },
      {
        title: "Captura de nota por foto/OCR",
        impact: "médio",
        effort: "alto",
        description:
          "Tirar foto do documento e pré-preencher fornecedor, valor e vencimento antes do lançamento.",
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

  const [order, setOrder] = useState<"desc" | "asc">("asc");

  const entries = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = CHANGELOG.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      if (!term) return true;
      return (
        item.title.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.track.toLowerCase().includes(term) ||
        formatDate(item.date).toLowerCase().includes(term)
      );
    });
    return filtered.sort((a, b) =>
      order === "desc" ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date),
    );
  }, [search, kind, order]);

  const total = CHANGELOG.length;
  const shown = entries.length;


  return (
    <div className="min-h-screen bg-background px-6 pb-16">
      <BackofficePageHeader
        title="Roadmap"
        description="Linha do tempo das entregas e sugestões de backlog"
        icon={<Rocket className="h-5 w-5 text-primary" />}
      />

      <main className="mx-auto max-w-5xl py-6">
        <p className="mb-4 text-xs text-muted-foreground">
          Datas confirmadas nas entregas recentes; entregas mais antigas usam data
          aproximada do período de implantação.
        </p>
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
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
          >
            <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
            {order === "desc" ? "Mais recentes" : "Mais antigas"}
          </Button>
        </div>

        {/* Changelog cronológico */}
        <section aria-label="Changelog de entregas">
          {entries.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Nenhuma entrega corresponde aos filtros.
            </p>
          )}

          <ol className="relative ml-3 border-l border-border pl-6">
            {entries.map((item, i) => {
              const meta = KIND_META[item.kind];
              const Icon = meta.icon;
              const newMonth = i === 0 || monthKey(entries[i - 1].date) !== monthKey(item.date);
              return (
                <li key={`${item.date}-${item.title}`} className="mb-4">
                  {newMonth && (
                    <h2 className="-ml-6 mb-3 mt-6 border-b border-border/60 pb-1 pl-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
                      {formatMonth(item.date)}
                    </h2>
                  )}
                  <span className="absolute -left-[9px] mt-4 flex h-4 w-4 items-center justify-center rounded-full border border-primary/40 bg-primary/20">
                    <CircleDot className="h-3 w-3 text-primary" />
                  </span>
                  <Card className="border-border/70">
                    <CardContent className="flex gap-3 p-4">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <time
                            dateTime={item.date}
                            className="font-mono text-xs text-muted-foreground"
                          >
                            {formatDate(item.date)}
                          </time>
                          <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                          <Badge variant="outline" className={`text-[10px] ${meta.className}`}>
                            {meta.label}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            {item.track}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
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

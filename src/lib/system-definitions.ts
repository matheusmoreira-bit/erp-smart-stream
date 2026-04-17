import { CreditCard, Server, Users, Box, Cloud, Building2, Layers, type LucideIcon } from "lucide-react";

export interface SystemField {
  key: string;
  label: string;
  type?: "text" | "password" | "custom_fields";
  placeholder?: string;
}

export interface SystemConfig {
  name: string;
  label: string;
  description: string;
  icon: LucideIcon;
  fields: SystemField[];
  category?: string;
}

const S4_COMMON_FIELDS: SystemField[] = [
  { key: "api_url", label: "URL da API (OData)", placeholder: "https://my-system.s4hana.cloud.sap/sap/opu/odata/sap/" },
  { key: "client_id", label: "Client ID (Communication Arrangement)", placeholder: "COMM_ARRANGEMENT_CLIENT" },
  { key: "client_secret", label: "Client Secret", type: "password", placeholder: "Segredo do Communication Arrangement" },
  { key: "username", label: "Usuário Técnico", placeholder: "TECH_USER" },
  { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário técnico" },
  { key: "sap_client", label: "SAP Client (Mandante)", placeholder: "100" },
];

export const SYSTEMS: SystemConfig[] = [
  {
    name: "sap",
    label: "SAP Business One",
    description: "Credencial usada para integrações automáticas (ex: PagCorp → SAP)",
    icon: Server,
    category: "erp",
    fields: [
      { key: "service_layer_url", label: "URL do Service Layer", placeholder: "https://servidor:50000/b1s/v1/" },
      { key: "company_db", label: "Banco de Dados", placeholder: "SBO_EMPRESA" },
      { key: "username", label: "Usuário de Integração", placeholder: "usuario_integracao" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário" },
      { key: "custom_fields", label: "Campos Customizados", type: "custom_fields" },
    ],
  },
  {
    name: "s4hana_cloud",
    label: "SAP S/4HANA Cloud",
    description: "ERP inteligente em nuvem pública — edição padrão (multi-tenant)",
    icon: Cloud,
    category: "erp",
    fields: S4_COMMON_FIELDS,
  },
  {
    name: "s4hana_cloud_private",
    label: "SAP S/4HANA Cloud Private Edition",
    description: "ERP em nuvem privada — infraestrutura dedicada com maior customização",
    icon: Cloud,
    category: "erp",
    fields: [
      ...S4_COMMON_FIELDS,
      { key: "token_url", label: "URL de Token OAuth", placeholder: "https://my-system.authentication.sap.hana.ondemand.com/oauth/token" },
    ],
  },
  {
    name: "s4hana_onprem",
    label: "SAP S/4HANA On-Premise",
    description: "ERP instalado localmente — controle total do ambiente e customizações ABAP",
    icon: Building2,
    category: "erp",
    fields: [
      { key: "api_url", label: "URL da API (OData/Gateway)", placeholder: "https://servidor:443/sap/opu/odata/sap/" },
      { key: "username", label: "Usuário RFC/Técnico", placeholder: "RFC_USER" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário RFC" },
      { key: "sap_client", label: "SAP Client (Mandante)", placeholder: "100" },
    ],
  },
  {
    name: "omie",
    label: "OMIE",
    description: "ERP em nuvem — gestão financeira, fiscal e operacional",
    icon: Box,
    category: "erp",
    fields: [
      { key: "app_key", label: "App Key", placeholder: "Chave do aplicativo OMIE" },
      { key: "app_secret", label: "App Secret", type: "password", placeholder: "Segredo do aplicativo OMIE" },
    ],
  },
  {
    name: "netsuite",
    label: "Oracle NetSuite",
    description: "ERP em nuvem Oracle — financeiro, CRM e e-commerce integrados",
    icon: Cloud,
    category: "erp",
    fields: [
      { key: "account_id", label: "Account ID", placeholder: "TSTDRV1234567" },
      { key: "consumer_key", label: "Consumer Key", placeholder: "Chave do consumidor (integração)" },
      { key: "consumer_secret", label: "Consumer Secret", type: "password", placeholder: "Segredo do consumidor" },
      { key: "token_id", label: "Token ID", placeholder: "Token de acesso" },
      { key: "token_secret", label: "Token Secret", type: "password", placeholder: "Segredo do token" },
    ],
  },
  {
    name: "totvs_protheus",
    label: "TOTVS Protheus",
    description: "ERP TOTVS Protheus — integração via REST API (TLPP/Advpl)",
    icon: Layers,
    category: "erp",
    fields: [
      { key: "api_url", label: "URL da API REST", placeholder: "https://servidor:8080/rest/" },
      { key: "username", label: "Usuário", placeholder: "admin" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário" },
      { key: "tenant_id", label: "Tenant ID (Empresa/Filial)", placeholder: "T1D010" },
    ],
  },
  {
    name: "totvs_rm",
    label: "TOTVS RM",
    description: "ERP TOTVS RM — integração via API REST / Web Services",
    icon: Layers,
    category: "erp",
    fields: [
      { key: "api_url", label: "URL da API", placeholder: "https://servidor/api/framework/v1/" },
      { key: "username", label: "Usuário", placeholder: "mestre" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário" },
      { key: "tenant_id", label: "Tenant / Coligada", placeholder: "1" },
    ],
  },
  {
    name: "totvs_datasul",
    label: "TOTVS Datasul",
    description: "ERP TOTVS Datasul — integração via API REST / UPC",
    icon: Layers,
    category: "erp",
    fields: [
      { key: "api_url", label: "URL da API", placeholder: "https://servidor/api/v1/" },
      { key: "username", label: "Usuário", placeholder: "super" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário" },
      { key: "company_code", label: "Código da Empresa", placeholder: "001" },
    ],
  },
  {
    name: "jumpcloud",
    label: "JumpCloud",
    description: "Gestão de identidades e diretório de usuários",
    icon: Users,
    fields: [
      { key: "api_key", label: "API Key", type: "password", placeholder: "Chave de API do JumpCloud" },
      { key: "org_id", label: "Organization ID", placeholder: "ID da organização" },
    ],
  },
  {
    name: "pagcorp",
    label: "PagCorp",
    description: "Gateway de pagamentos corporativos",
    icon: CreditCard,
    fields: [
      { key: "api_base_url", label: "URL Base da API", placeholder: "https://bifrost.acgsa.com.br/kraken/v1/" },
      { key: "client_key", label: "Client Key", placeholder: "UUID do client" },
      { key: "client_secret", label: "Client Secret", type: "password", placeholder: "UUID do secret" },
      { key: "login_email", label: "Login / Email", placeholder: "usuario_login" },
      { key: "login_password", label: "Senha", type: "password", placeholder: "Senha de acesso" },
      { key: "aes_key", label: "Chave AES (Base64)", type: "password", placeholder: "Chave AES-256 em Base64" },
      { key: "hmac_key", label: "Chave HMAC (Base64)", type: "password", placeholder: "Chave HMAC-SHA256 em Base64" },
      { key: "account_id", label: "Account ID", placeholder: "ID da conta PagCorp" },
    ],
  },
];

export const CATEGORY_LABELS: Record<string, string> = {
  erp: "ERP",
};

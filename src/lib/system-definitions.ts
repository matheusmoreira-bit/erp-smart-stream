import { CreditCard, Server, Users, type LucideIcon } from "lucide-react";

export interface SystemField {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
}

export interface SystemConfig {
  name: string;
  label: string;
  description: string;
  icon: LucideIcon;
  fields: SystemField[];
}

export const SYSTEMS: SystemConfig[] = [
  {
    name: "sap",
    label: "SAP Business One",
    description: "Credencial usada para integrações automáticas (ex: PagCorp → SAP)",
    icon: Server,
    fields: [
      { key: "service_layer_url", label: "URL do Service Layer", placeholder: "https://servidor:50000/b1s/v1/" },
      { key: "company_db", label: "Banco de Dados", placeholder: "SBO_EMPRESA" },
      { key: "username", label: "Usuário de Integração", placeholder: "usuario_integracao" },
      { key: "password", label: "Senha", type: "password", placeholder: "Senha do usuário" },
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

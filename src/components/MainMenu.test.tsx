import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MainMenu } from "./MainMenu";

const mocks = vi.hoisted(() => ({
  userModules: [] as string[],
}));

vi.mock("@/components/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <header>{title}</header>,
}));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/OfflineQueueIndicator", () => ({ OfflineQueueIndicator: () => null }));
vi.mock("@/hooks/useCompanies", () => ({
  useCompanies: () => ({ getLabel: () => "Empresa teste" }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  useModuleAccess: () => ({ userModules: mocks.userModules, loading: false }),
}));
vi.mock("@/contexts/SapContext", () => ({
  useSap: () => ({ session: { companyDB: "TESTE" } }),
}));

function renderMenu() {
  return render(
    <MemoryRouter>
      <MainMenu />
    </MemoryRouter>,
  );
}

describe("MainMenu", () => {
  beforeEach(() => {
    mocks.userModules = [
      "expenses",
      "approvals",
      "approval_history",
      "sales",
      "pagcorp",
      "suppliers",
      "items",
      "intercompany",
      "financial_review",
      "nf_entrada",
      "analytics",
      "audit_console",
      "users",
      "users_productivity",
      "approval_rules",
      "synapse",
      "integration_history",
      "employee_integration",
      "credentials",
      "notifications",
    ];
  });

  it("organizes options by use case", () => {
    renderMenu();

    expect(screen.getByRole("heading", { name: "Compras e aprovações" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vendas e recebimentos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pedidos de compra/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Vendas" }));
    expect(screen.getByRole("button", { name: /Pedidos de venda/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pedidos de compra/ })).not.toBeInTheDocument();
  });

  it("searches across every use case", () => {
    renderMenu();

    fireEvent.change(screen.getByPlaceholderText("Buscar na página inicial"), {
      target: { value: "credenciais" },
    });

    expect(screen.getByRole("button", { name: /Credenciais/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pedidos de compra/ })).not.toBeInTheDocument();
  });

  it("hides destinations outside the current permissions", () => {
    mocks.userModules = ["expenses"];
    renderMenu();

    expect(screen.getByRole("button", { name: /Pedidos de compra/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pedidos de venda/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Administração" })).not.toBeInTheDocument();
  });
});

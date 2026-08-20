import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BackofficeChangePasswordDialog } from "@/components/BackofficeChangePasswordDialog";

const changePasswordInCompanies = vi.fn();

vi.mock("@/lib/sap-multi-password", () => ({
  listSapTargetCompanies: vi.fn().mockResolvedValue([]),
  changePasswordInCompanies: (...args: unknown[]) => changePasswordInCompanies(...args),
}));

describe("BackofficeChangePasswordDialog", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  beforeEach(() => {
    changePasswordInCompanies.mockReset();
    changePasswordInCompanies.mockResolvedValue([
      { companyDB: "SBO_TEST", displayName: "Teste", status: "success" },
    ]);
  });

  it("habilita provisionamento apenas para senha aleatoria ou conhecida", async () => {
    render(
      <BackofficeChangePasswordDialog
        open
        onOpenChange={vi.fn()}
        userCode="artur.angelo"
        userName="Artur Angelo"
        targetEmail="artur@empresa.com"
        currentCompanyDb="SBO_TEST"
      />,
    );

    const provision = screen.getByRole("switch", { name: "Provisionar senha" });
    expect(provision).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Senha aleatória/i }));
    expect(provision).toBeEnabled();
    fireEvent.click(provision);
    fireEvent.click(screen.getByRole("button", { name: "Redefinir e provisionar" }));

    await waitFor(() => expect(changePasswordInCompanies).toHaveBeenCalled());
    expect(changePasswordInCompanies.mock.calls[0][4]).toBe(true);
    expect(changePasswordInCompanies.mock.calls[0][5]).toEqual({ targetEmail: "artur@empresa.com" });
  });
});

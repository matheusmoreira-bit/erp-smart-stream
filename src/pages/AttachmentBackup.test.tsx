import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AttachmentBackup from "./AttachmentBackup";
import { BUCKETS } from "@/lib/attachment-backup";

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  rpc: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser }, rpc: mocks.rpc },
}));
vi.mock("@/components/BackofficePageHeader", () => ({ BackofficePageHeader: () => null }));

function result(name = "nota.pdf") {
  return { data: [{ name, bytes: 100, version: "1" }], error: null };
}
function inventories() {
  return mocks.rpc.mock.calls.filter(([name]) => name === "attachment_backup_inventory");
}

beforeEach(() => {
  mocks.user = null;
  mocks.rpc.mockReset();
  mocks.getUser.mockReset().mockImplementation(async () => ({ data: { user: mocks.user }, error: null }));
  mocks.rpc.mockImplementation((name: string) => name === "has_role"
    ? Promise.resolve({ data: true, error: null })
    : { abortSignal: () => Promise.resolve(result()) });
  localStorage.clear();
});
afterEach(cleanup);

describe("inventário vinculado ao usuário autenticado", () => {
  it("aguarda user null → usuário e aplica os resultados dos seis buckets", async () => {
    const view = render(<AttachmentBackup />);
    await act(async () => {});
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(inventories()).toHaveLength(0);

    mocks.user = { id: "admin-a" };
    view.rerender(<AttachmentBackup />);
    await waitFor(() => expect(inventories()).toHaveLength(6));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("6 / 6 buckets conferidos · 6 arquivos"));
    expect(inventories().map(([, args]) => args.p_bucket)).toEqual(BUCKETS);
  });

  it("recarrega ao trocar o usuário e ignora respostas antigas ainda pendentes", async () => {
    let finish: ((value: ReturnType<typeof result>) => void) | undefined;
    const pending = new Promise<ReturnType<typeof result>>(resolve => { finish = resolve; });
    mocks.rpc.mockImplementation((name: string) => name === "has_role"
      ? Promise.resolve({ data: true, error: null })
      : { abortSignal: () => mocks.user?.id === "admin-a" ? pending : Promise.resolve(result()) });
    mocks.user = { id: "admin-a" };
    const view = render(<AttachmentBackup />);
    await waitFor(() => expect(inventories()).toHaveLength(6));

    mocks.user = { id: "admin-b" };
    view.rerender(<AttachmentBackup />);
    await waitFor(() => expect(inventories()).toHaveLength(12));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("6 / 6 buckets conferidos · 6 arquivos"));
    if (!finish) throw new Error("Resposta pendente não inicializada");
    await act(async () => { finish?.({ data: [], error: null }); });
    expect(screen.getByRole("status")).toHaveTextContent("6 / 6 buckets conferidos · 6 arquivos");
  });
});
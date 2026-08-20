import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearAuthCache: vi.fn(),
  getIsCloudAdmin: vi.fn(),
  getIsSapUserAdmin: vi.fn(),
  getGroupAssignments: vi.fn(),
  getGroupModules: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/contexts/SapContext", () => ({
  useSap: () => ({
    session: {
      userName: "test.user",
      companyDB: "SBO_TEST",
      erpType: "sap",
      isSuperUser: false,
    },
  }),
}));

vi.mock("@/lib/auth-cache", () => ({
  clearAuthCache: mocks.clearAuthCache,
  getIsCloudAdmin: mocks.getIsCloudAdmin,
  getIsSapUserAdmin: mocks.getIsSapUserAdmin,
  getGroupAssignments: mocks.getGroupAssignments,
  getGroupModules: mocks.getGroupModules,
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  return {
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: mocks.removeChannel,
    },
  };
});

import { useModuleAccess } from "./usePermissions";

afterEach(() => {
  vi.clearAllMocks();
});

describe("useModuleAccess focus refresh", () => {
  it("keeps the route mounted while permissions refresh in the background", async () => {
    mocks.getIsCloudAdmin.mockResolvedValueOnce(false);
    mocks.getIsSapUserAdmin.mockResolvedValue(false);
    mocks.getGroupAssignments.mockResolvedValue([]);
    mocks.getGroupModules.mockResolvedValue([]);

    const { result } = renderHook(() => useModuleAccess("expenses"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasAccess).toBe(true);

    let finishRefresh: (value: boolean) => void = () => {};
    mocks.getIsCloudAdmin.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => { finishRefresh = resolve; }),
    );

    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(mocks.getIsCloudAdmin).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(false);
    expect(result.current.hasAccess).toBe(true);

    await act(async () => finishRefresh(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

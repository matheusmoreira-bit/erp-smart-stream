import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCircuitState,
  recordCircuitFailure,
  recordCircuitSuccess,
  resetCircuit,
} from "./sap-circuit-breaker";

describe("SAP circuit breaker resiliente", () => {
  beforeEach(() => {
    resetCircuit();
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetCircuit();
    vi.useRealTimers();
  });

  it("notifica na primeira falha e abre após falhas consecutivas", () => {
    const events: Array<{ available: boolean }> = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener("erp:sap-connectivity", listener);

    for (let count = 0; count < 4; count++) recordCircuitFailure("SBO_TEST", "timeout");

    expect(events).toHaveLength(1);
    expect(events[0].available).toBe(false);
    expect(getCircuitState("SBO_TEST").state).toBe("open");
    expect(localStorage.getItem("erp:sap-circuit:SBO_TEST")).toContain("timeout");
    window.removeEventListener("erp:sap-connectivity", listener);
  });

  it("fecha o circuito e sinaliza recuperação após uma resposta válida", () => {
    const recovered = vi.fn();
    window.addEventListener("erp:sap-connectivity", recovered);
    recordCircuitFailure("SBO_TEST", "network");

    recordCircuitSuccess("SBO_TEST");

    expect(getCircuitState("SBO_TEST").state).toBe("closed");
    expect(localStorage.getItem("erp:sap-circuit:SBO_TEST")).toBeNull();
    expect(recovered).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ available: true }),
    }));
    window.removeEventListener("erp:sap-connectivity", recovered);
  });
});

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldShortCircuit, type HanaProbeRow } from "./hana-circuit.ts";

const now = Date.parse("2026-11-12T13:40:00Z");
const at = (secAgo: number, ok = false, msg: string | null = "sem comunicação: Signal timed out.") =>
  ({ ok, error_message: ok ? null : msg, created_at: new Date(now - secAgo * 1000).toISOString() }) as HanaProbeRow;

Deno.test("abre com 3 falhas de rede seguidas e a última há menos de 60 s", () => {
  assertEquals(shouldShortCircuit([at(10), at(50), at(90)], now), true);
});

Deno.test("libera tentativa real quando a última falha tem 60 s ou mais", () => {
  assertEquals(shouldShortCircuit([at(60), at(100), at(140)], now), false);
});

Deno.test("não abre com menos de 3 falhas na janela de 5 min", () => {
  assertEquals(shouldShortCircuit([at(10), at(50), at(400)], now), false);
});

Deno.test("um sucesso recente fecha o disjuntor", () => {
  assertEquals(shouldShortCircuit([at(5), at(10), at(20), at(30, true)], now), false);
});

Deno.test("resposta HTTP (servidor alcançável) não abre o disjuntor", () => {
  assertEquals(shouldShortCircuit([at(5, false, "HTTP 500"), at(10), at(20)], now), false);
});

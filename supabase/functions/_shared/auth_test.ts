// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseSapHeaders } from "./auth.ts";

function mk(h: Record<string, string>): Request {
  return new Request("http://x", { headers: new Headers(h) });
}

Deno.test("parseSapHeaders: aceita headers válidos", () => {
  const r = parseSapHeaders(mk({
    "x-sap-session": "ABCDEF1234567890abcdef",
    "x-sap-route": ".node1",
    "x-sap-user": "joao.silva",
    "x-company-db": "SBODEMOBR",
  }));
  assertEquals(r?.sapUser, "joao.silva");
  assertEquals(r?.companyDB, "SBODEMOBR");
  assertEquals(r?.sapAuthToken, "");
});

Deno.test("parseSapHeaders: obrigatórios ausentes → null", () => {
  assertEquals(parseSapHeaders(mk({})), null);
  assertEquals(parseSapHeaders(mk({
    "x-sap-session": "abc12345",
    "x-sap-user": "u",
  })), null);
});

Deno.test("parseSapHeaders: injeção CR/LF é rejeitada", () => {
  assertEquals(parseSapHeaders(mk({
    "x-sap-session": "abc12345",
    "x-sap-user": "u",
    // Header API já normaliza, mas testamos charset extra
    "x-company-db": "SBO/../etc",
  })), null);
});

Deno.test("parseSapHeaders: user com caracteres inválidos → null", () => {
  assertEquals(parseSapHeaders(mk({
    "x-sap-session": "abc12345",
    "x-sap-user": "user; drop table",
    "x-company-db": "SBO",
  })), null);
});

Deno.test("parseSapHeaders: session curta demais → null", () => {
  assertEquals(parseSapHeaders(mk({
    "x-sap-session": "abc",
    "x-sap-user": "u",
    "x-company-db": "SBO",
  })), null);
});

Deno.test("parseSapHeaders: session absurdamente longa → null", () => {
  assertEquals(parseSapHeaders(mk({
    "x-sap-session": "A".repeat(700),
    "x-sap-user": "u",
    "x-company-db": "SBO",
  })), null);
});

Deno.test("parseSapHeaders: authToken malformado → null", () => {
  assertEquals(parseSapHeaders(mk({
    "x-sap-session": "abc12345",
    "x-sap-user": "u",
    "x-company-db": "SBO",
    "x-sap-auth-token": "not-a-jws",
  })), null);
});

Deno.test("parseSapHeaders: authToken bem formado passa", () => {
  const r = parseSapHeaders(mk({
    "x-sap-session": "abc12345",
    "x-sap-user": "u",
    "x-company-db": "SBO",
    "x-sap-auth-token": "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop",
  }));
  assertEquals(r?.sapAuthToken, "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop");
});

Deno.test("parseSapHeaders: companyDB só aceita alfa-numérico/_/-", () => {
  assertEquals(parseSapHeaders(mk({
    "x-sap-session": "abc12345",
    "x-sap-user": "u",
    "x-company-db": "SBO DEMO",
  })), null);
});

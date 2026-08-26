import { describe, expect, it } from "vitest";
import {
  createOktaClientAssertion,
  normalizeOktaOrgUrl,
  normalizeOktaUser,
} from "../../supabase/functions/_shared/okta";

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(normalized + padding);
}

function toPem(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  const body = btoa(binary).match(/.{1,64}/g)?.join("\n") || "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
}

describe("Okta integration helpers", () => {
  it("normalizes an Okta organization origin", () => {
    expect(normalizeOktaOrgUrl("acme.okta.com/")).toBe("https://acme.okta.com");
    expect(() => normalizeOktaOrgUrl("http://acme.okta.com")).toThrow(/HTTPS/);
    expect(() => normalizeOktaOrgUrl("https://acme.okta.com/oauth2/default")).toThrow(/apenas a origem/);
  });

  it("normalizes Okta users to the provider-neutral contract", () => {
    expect(normalizeOktaUser({
      id: "00u123",
      status: "SUSPENDED",
      profile: {
        login: "ana@example.com",
        email: "ana@example.com",
        firstName: "Ana",
        lastName: "Silva",
        department: "Financeiro",
        costCenter: "1.2.3 - FINANCEIRO",
        title: "Analista",
        employeeNumber: "42",
      },
    })).toMatchObject({
      _id: "00u123",
      username: "ana@example.com",
      displayname: "Ana Silva",
      suspended: true,
      department: "Financeiro",
      costCenter: "1.2.3 - FINANCEIRO",
      jobTitle: "Analista",
      employeeIdentifier: "42",
    });
  });

  it("creates a verifiable RS256 client assertion with the org token audience", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const pem = toPem(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
    const assertion = await createOktaClientAssertion({
      org_url: "https://acme.okta.com",
      client_id: "0oa-service-app",
      private_key: pem,
      key_id: "key-1",
    }, Date.UTC(2026, 7, 25, 12));
    const [encodedHeader, encodedPayload, encodedSignature] = assertion.split(".");
    expect(JSON.parse(base64UrlDecode(encodedHeader))).toMatchObject({ alg: "RS256", kid: "key-1" });
    expect(JSON.parse(base64UrlDecode(encodedPayload))).toMatchObject({
      aud: "https://acme.okta.com/oauth2/v1/token",
      iss: "0oa-service-app",
      sub: "0oa-service-app",
    });
    const signature = Uint8Array.from(base64UrlDecode(encodedSignature), (char) => char.charCodeAt(0));
    await expect(crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keyPair.publicKey,
      signature,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    )).resolves.toBe(true);
  });
});

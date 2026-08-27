import { describe, expect, it } from "vitest";
import {
  buildNfsePublicConsultationUrl,
  normalizeNfseAccessKey,
} from "./nfse-public-consultation";

const ACCESS_KEY = "53001082247550802000139000000000001124072903992230";

describe("NFS-e public consultation", () => {
  it("normalizes a 50-digit access key", () => {
    expect(normalizeNfseAccessKey(ACCESS_KEY)).toBe(ACCESS_KEY);
    expect(normalizeNfseAccessKey(` ${ACCESS_KEY.slice(0, 25)} ${ACCESS_KEY.slice(25)} `)).toBe(ACCESS_KEY);
  });

  it("rejects an invalid access key", () => {
    expect(normalizeNfseAccessKey("123")).toBeNull();
    expect(buildNfsePublicConsultationUrl(null)).toBeNull();
  });

  it("builds the official consultation URL with the key prefilled", () => {
    expect(buildNfsePublicConsultationUrl(ACCESS_KEY)).toBe(
      `https://www.nfse.gov.br/ConsultaPublica/?chave=${ACCESS_KEY}&tpc=1`,
    );
  });
});

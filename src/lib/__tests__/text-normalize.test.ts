import { describe, it, expect } from "vitest";
import {
  stripDiacritics,
  normalizeText,
  normalizeWords,
  normalizeUpper,
  normalizeCompact,
  slugify,
  emailLocalPart,
  canonicalIdentity,
  canonicalUserKey,
  identityMatches,
  tokenizePerson,
} from "@/lib/text-normalize";

describe("text-normalize / acentos", () => {
  it("remove diacríticos preservando o texto", () => {
    expect(stripDiacritics("Mourão")).toBe("Mourao");
    expect(stripDiacritics("José Antônio Gonçalves")).toBe("Jose Antonio Goncalves");
    expect(stripDiacritics("ÁÉÍÓÚÀÂÊÔÃÕÜÇ")).toBe("AEIOUAAEOAOUC");
  });

  it("normalizeText é idempotente e tolera nulos", () => {
    expect(normalizeText("  Fábio   MOURÃO  ")).toBe("fabio mourao");
    expect(normalizeText(normalizeText("Fábio  Mourão"))).toBe("fabio mourao");
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });

  it("caracteres especiais viram separadores em normalizeWords/Upper", () => {
    expect(normalizeWords("Cactus-Tecnologia S.A.")).toBe("cactus tecnologia s a");
    expect(normalizeUpper("Gestão & Pessoas / C&C")).toBe("GESTAO PESSOAS C C");
    expect(normalizeCompact("1.5.1.3 – Pessoas e Cultura")).toBe("1513pessoasecultura");
    expect(slugify("Solicitação de Cadastro!")).toBe("solicitacao-de-cadastro");
  });

  it("emailLocalPart extrai o UserCode do SAP", () => {
    expect(emailLocalPart("Joao.Mourão@Empresa.com.br")).toBe("joao.mourao");
    expect(emailLocalPart("joao.mourao")).toBe("joao.mourao");
    expect(emailLocalPart("@dominio.com")).toBe("@dominio.com");
  });

  it("canonicalIdentity e canonicalUserKey ignoram sufixos de conta externa", () => {
    expect(canonicalIdentity("Blenda.Pinheiro@x.com")).toBe("blendapinheiro");
    expect(canonicalUserKey("blenda.pinheiro.ext@x.com")).toBe("blendapinheiro");
    expect(canonicalUserKey("blenda.pinheiro-externo")).toBe("blendapinheiro");
    expect(canonicalUserKey("")).toBe("");
  });

  it("identityMatches casa e-mail, UserCode e variações acentuadas", () => {
    expect(identityMatches("joao.mourão@a.com", "JOAO.MOURAO")).toBe(true);
    expect(identityMatches("blenda.pinheiro.ext@a.com", "blenda.pinheiro@a.com")).toBe(true);
    expect(identityMatches("joao.mourao", "maria.mourao")).toBe(false);
    expect(identityMatches("", "joao")).toBe(false);
    expect(identityMatches(null, undefined)).toBe(false);
  });

  it("tokenizePerson descarta conectores, domínio e pontuação", () => {
    expect(tokenizePerson("João da Silva Mourão")).toEqual(["joao", "silva", "mourao"]);
    expect(tokenizePerson("joao.silva-mourao@empresa.com.br")).toEqual(["joao", "silva", "mourao"]);
    expect(tokenizePerson("   ")).toEqual([]);
  });
});

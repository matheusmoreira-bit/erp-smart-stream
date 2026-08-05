import { describe, it, expect } from "vitest";
import { isDesignatedApprover, canCallerApproveInternal, type InternalExpense } from "@/lib/approval-authz";
import { identityMatches, canonicalUserKey } from "@/lib/text-normalize";
import { requesterMatchesApprover } from "../../../supabase/functions/_shared/approval-skip.ts";

/**
 * Fixture com pessoas REAIS do diretório (`sap_user_directory` + `sap_user_emails`)
 * escolhidas por serem os casos de risco: acento no nome, grafias divergentes,
 * primeiro nome ou sobrenome repetidos e contas .ext.
 */
const DIR = {
  icaro: { code: "icaro.dutra", name: "Ícaro Dutra", email: "icaro.dutra@opengaming.com.br" },
  blenda: { code: "blenda.pinheiro.ext", name: "Blenda Pinheiro", email: "blenda.pinheiro@anagaming.com.br" },
  erika: { code: "erika.araujo", name: "Erika Caroline de Araujo", email: "erika.araujo@anagaming.com.br" },
  andresa: { code: "andresa.carvalho", name: "Andresa De Carvalho", email: "andresa.carvalho@anagaming.com.br" },
  anaAraujo: { code: "ana.araujo", name: "Ana Araujo", email: null },
  andersonAraujo: { code: "anderson.araujo", name: "Anderson Araujo", email: "anderson.araujo@anagaming.com.br" },
  douglasSilva: { code: "douglas.silva", name: "Douglas Silva", email: "douglas.silva@anagaming.com.br" },
  vivianeSilva: { code: "viviane.silva", name: "Viviane Silva", email: "viviane.silva@anagaming.com.br" },
  douglasVinicius: { code: "douglas.vinicius", name: "Douglas Vinicius", email: "douglas.vinicius@anagaming.com.br" },
  antonioGerard: { code: "antonio.gerardi", name: "Antonio Gerard", email: "antonio.gerardi@anagaming.com.br" },
  antonioGuerardi: { code: "antonio.guerardi", name: "Antonio Guerardi", email: "antonio.guerardi@anagaming.com.br" },
  amandaTeixeira: { code: "amanda.teixeira", name: "Amanda Teixeira", email: "amanda.teixeira@opengaming.com.br" },
  amandaTexeira: { code: "amanda.texeira", name: "", email: "amanda.texeira@anagaming.com.br" },
  felipe: { code: "felipe.coelho", name: "Felipe Coelho", email: "felipe.coelho@cactusgaming.net" },
  julianaG: { code: "juliana.gavineli", name: "Juliana Gavineli", email: "juliana.gavineli@anagaming.com.br" },
  julianaM: { code: "juliana.monteiro", name: "Juliana Monteiro", email: "juliana.monteiro@cactusgaming.net" },
} as const;

type Person = { code: string; name: string; email: string | null };

const pending = (approver: Person, requester: Person, over: Partial<InternalExpense> = {}): InternalExpense => ({
  id: "doc",
  status: "pendente_aprovacao",
  current_level_order: 1,
  current_approver: null,
  original_approver: null,
  requester_email: requester.email,
  requester_name: requester.name,
  rule_levels: [{ level_order: 1, approver_name: approver.name, approver_email: approver.email }],
  ...over,
});

describe("dados reais — aprovador com acento não perde o documento", () => {
  it("Ícaro Dutra aprova entrando por e-mail, UserCode ou nome sem acento", () => {
    const exp = pending(DIR.icaro, DIR.felipe);
    for (const caller of ["icaro.dutra@opengaming.com.br", "icaro.dutra", "ICARO.DUTRA", "Ícaro Dutra", "Icaro Dutra"]) {
      expect(canCallerApproveInternal(caller, exp), caller).toBe(true);
    }
  });

  it("nome do aprovador acentuado na regra x login sem acento (e vice-versa)", () => {
    expect(isDesignatedApprover("icaro.dutra", "Ícaro Dutra", null)).toBe(true);
    expect(isDesignatedApprover("Ícaro Dutra", "Icaro Dutra", null)).toBe(true);
  });

  it("Erika Caroline de Araujo: UserCode curto casa com nome completo", () => {
    expect(isDesignatedApprover("erika.araujo", DIR.erika.name, null)).toBe(true);
    expect(isDesignatedApprover("Erika Araújo", DIR.erika.name, null)).toBe(true);
  });

  it("Andresa De Carvalho: conector 'de' não quebra o match", () => {
    expect(isDesignatedApprover("andresa.carvalho", DIR.andresa.name, null)).toBe(true);
  });

  it("conta .ext e conta principal são a mesma pessoa", () => {
    expect(identityMatches("blenda.pinheiro.ext@anagaming.com.br", DIR.blenda.email)).toBe(true);
    expect(canonicalUserKey(DIR.blenda.code)).toBe(canonicalUserKey(DIR.blenda.email));
    expect(canCallerApproveInternal("blenda.pinheiro.ext@anagaming.com.br", pending(DIR.blenda, DIR.felipe))).toBe(true);
  });
});

describe("dados reais — nomes parecidos não vazam aprovação", () => {
  const distintos: Array<[Person, Person]> = [
    [DIR.anaAraujo, DIR.andersonAraujo],
    [DIR.douglasSilva, DIR.vivianeSilva],
    [DIR.douglasSilva, DIR.douglasVinicius],
    [DIR.antonioGerard, DIR.antonioGuerardi],
    [DIR.amandaTeixeira, DIR.amandaTexeira],
    [DIR.julianaG, DIR.julianaM],
  ];

  it.each(distintos)("%o não aprova documento de %o", (a, b) => {
    const exp = pending(b, DIR.felipe);
    expect(canCallerApproveInternal(a.code, exp)).toBe(false);
    if (a.email) expect(canCallerApproveInternal(a.email, exp)).toBe(false);
    expect(canCallerApproveInternal(a.name, exp)).toBe(false);
  });

  it("cada um aprova o próprio documento (nenhum some)", () => {
    for (const p of Object.values(DIR) as Person[]) {
      if (!p.name && !p.email) continue;
      const exp = pending(p, DIR.felipe);
      const caller = p.email || p.code;
      expect(canCallerApproveInternal(caller, exp), caller).toBe(true);
    }
  });
});

describe("dados reais — auto-aprovação e delegação com grafias diferentes", () => {
  it("solicitante = aprovador é detectado mesmo com acento/UserCode", () => {
    expect(requesterMatchesApprover("Ícaro Dutra", "icaro.dutra", "Icaro Dutra", DIR.icaro.email)).toBe(true);
    expect(requesterMatchesApprover(null, "blenda.pinheiro.ext@anagaming.com.br", "Blenda Pinheiro", DIR.blenda.email)).toBe(true);
  });

  it("homônimos parciais NÃO são tratados como a mesma pessoa", () => {
    expect(requesterMatchesApprover("Ana Araujo", null, "Anderson Araujo", DIR.andersonAraujo.email)).toBe(false);
    expect(requesterMatchesApprover("Juliana Monteiro", DIR.julianaM.email, "Juliana Gavineli", DIR.julianaG.email)).toBe(false);
    expect(requesterMatchesApprover("Douglas Silva", DIR.douglasSilva.email, "Douglas Vinicius", DIR.douglasVinicius.email)).toBe(false);
  });

  it("delegação: substituto com nome acentuado assume e o titular sai", () => {
    const exp = pending(DIR.felipe, DIR.julianaM, { current_approver: "Ícaro Dutra" });
    expect(canCallerApproveInternal("icaro.dutra", exp)).toBe(true);
    expect(canCallerApproveInternal("ICARO DUTRA", exp)).toBe(true);
    expect(canCallerApproveInternal(DIR.felipe.email!, exp)).toBe(false);
  });

  it("delegação por e-mail .ext funciona com login da conta principal", () => {
    const exp = pending(DIR.felipe, DIR.julianaM, { current_approver: "blenda.pinheiro.ext@anagaming.com.br" });
    expect(canCallerApproveInternal("blenda.pinheiro@anagaming.com.br", exp)).toBe(true);
  });
});

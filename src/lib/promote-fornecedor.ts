import { createSupplier, findSupplierByTaxId, type SupplierInput } from "@/hooks/useSuppliers";
import type { SapSession } from "@/lib/sap-client";

const digits = (s: string) => (s || "").replace(/\D+/g, "");

/**
 * Promotes a fornecedor (local table) to suppliers + SAP for the active company.
 * - Skips if the federal tax id already exists in suppliers for the given companyDB.
 * - Otherwise creates a BusinessPartner in SAP and a row in suppliers via createSupplier.
 */
export async function syncFornecedorToSap(
  fornecedor: any,
  session: SapSession,
): Promise<{ ok: boolean; skipped?: boolean; message?: string; cardCode?: string | null }> {
  const taxId = digits(String(fornecedor?.cnpj || fornecedor?.cpf || ""));
  if (!taxId) return { ok: false, message: "Sem CNPJ/CPF para enviar ao SAP" };

  const existing = await findSupplierByTaxId(taxId, session.companyDB);
  if (existing) {
    return {
      ok: true,
      skipped: true,
      cardCode: existing.card_code,
      message: `Já existe em ${session.companyDB} (CardCode ${existing.card_code || "?"})`,
    };
  }

  const name = String(fornecedor?.razao_social || fornecedor?.nome_fantasia || "").trim();
  if (!name) return { ok: false, message: "Sem razão social/nome" };

  const street = [fornecedor?.logradouro, fornecedor?.numero].filter(Boolean).join(", ") || null;
  const input: SupplierInput = {
    company_db: session.companyDB,
    card_code: null,
    card_name: name.slice(0, 100),
    card_type: "S",
    federal_tax_id: taxId,
    u_fgr_taxid0: taxId,
    email: fornecedor?.email || null,
    phone1: fornecedor?.telefone1 || null,
    phone2: fornecedor?.telefone2 || null,
    currency: "BRL",
    bill_to_street: street,
    bill_to_zip: (fornecedor?.cep || "").replace(/\D/g, "") || null,
    bill_to_city: fornecedor?.municipio || null,
    bill_to_state: fornecedor?.uf || null,
    bill_to_country:
      fornecedor?.pais && String(fornecedor.pais).toUpperCase() !== "BRASIL" ? fornecedor.pais : "BR",
    bill_to_block: fornecedor?.bairro || null,
    bill_to_building: fornecedor?.complemento || null,
    is_active: true,
    source: "local",
  };

  try {
    const created = await createSupplier(input, session);
    if (created.sap_sync_status === "error") {
      return { ok: false, message: created.sap_sync_error || "Erro ao criar no SAP", cardCode: created.card_code };
    }
    return {
      ok: true,
      cardCode: created.card_code,
      message: `Criado no SAP (CardCode ${created.card_code || "?"})`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Erro ao sincronizar SAP" };
  }
}

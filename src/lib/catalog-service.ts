import { runtime } from "@/config/runtime";
import { supabase } from "@/integrations/supabase/client";
import { invokeFn } from "@/lib/invoke-fn";

type FunctionResult<T> = { data: T | null; error: Error | null };

export type ItemOperationResponse = {
  ok?: boolean;
  error?: string;
  base?: unknown;
  code?: string;
  variante?: unknown;
  created?: boolean;
};

function asError(error: unknown): Error | null {
  if (!error) return null;
  return error instanceof Error ? error : new Error(String((error as { message?: unknown }).message || error));
}

export async function saveFornecedor(payload: Record<string, unknown>): Promise<FunctionResult<Record<string, unknown>>> {
  if (!runtime.isStandaloneLocal) {
    return await invokeFn<Record<string, unknown>>("fornecedor-save", { body: { payload } });
  }

  const tipo = payload.tipo_pessoa;
  const field = tipo === "pj" ? "cnpj" : "cpf";
  const value = String(payload[field] || "").replace(/\D+/g, "");
  if (!value) return { data: null, error: new Error(`${field.toUpperCase()} inválido`) };

  const { data: existing, error: findError } = await supabase
    .from("fornecedores")
    .select("*")
    .eq(field, value)
    .maybeSingle();
  if (findError) return { data: null, error: asError(findError) };
  if (existing) {
    return { data: { ok: true, id: existing.id, existed: true, fornecedor: existing }, error: null };
  }

  const { data, error } = await supabase
    .from("fornecedores")
    .insert({ ...payload, [field]: value } as never)
    .select("*")
    .single();
  return error
    ? { data: null, error: asError(error) }
    : { data: { ok: true, id: data.id, existed: false, fornecedor: data }, error: null };
}

export async function runItemOperation(body: Record<string, unknown>): Promise<FunctionResult<ItemOperationResponse>> {
  if (!runtime.isStandaloneLocal) {
    return await invokeFn<ItemOperationResponse>("item-save", { body });
  }

  const action = String(body.action || "");
  if (action === "findOrCreateBase") {
    const tipo = body.tipo === "servico" ? "servico" : "produto";
    const matchField = tipo === "produto" ? "ncm" : "codigo_servico";
    const matchValue = String(body[matchField] || "");
    const { data: existing, error: findError } = await supabase
      .from("item_base")
      .select("*")
      .eq("tipo", tipo)
      .eq(matchField, matchValue)
      .maybeSingle();
    if (findError) return { data: null, error: asError(findError) };
    if (existing) return { data: { ok: true, base: existing, created: false }, error: null };

    const { data, error } = await supabase
      .from("item_base")
      .insert({
        tipo,
        ncm: tipo === "produto" ? matchValue : null,
        codigo_servico: tipo === "servico" ? matchValue : null,
        grupo: body.grupo ? String(body.grupo) : null,
        unidade: body.unidade ? String(body.unidade) : null,
      })
      .select("*")
      .single();
    return error
      ? { data: null, error: asError(error) }
      : { data: { ok: true, base: data, created: true }, error: null };
  }

  if (action === "previewCode") {
    const { data, error } = await supabase.rpc("preview_next_codigo", {
      p_item_base_id: String(body.item_base_id || ""),
    });
    return error
      ? { data: null, error: asError(error) }
      : { data: { ok: true, code: data }, error: null };
  }

  if (action === "createVariante") {
    const { data, error } = await supabase.rpc("create_item_variante", {
      p_item_base_id: String(body.item_base_id || ""),
      p_descricao: String(body.descricao || "").trim(),
    });
    return error
      ? { data: null, error: asError(error) }
      : { data: { ok: true, variante: data }, error: null };
  }

  return { data: null, error: new Error("Operação de item inválida") };
}

export async function syncSupplierLocal(
  body: { action: "findByTaxId"; taxId: string; companyDb: string } | { action: "insert"; row: Record<string, unknown> },
): Promise<FunctionResult<Record<string, unknown>>> {
  if (!runtime.isStandaloneLocal) {
    return await invokeFn<Record<string, unknown>>("supplier-sync", { body });
  }

  if (body.action === "findByTaxId") {
    const cleaned = body.taxId.replace(/\D/g, "");
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("company_db", body.companyDb)
      .or(`federal_tax_id.eq.${body.taxId},federal_tax_id.eq.${cleaned}`)
      .limit(1)
      .maybeSingle();
    return error
      ? { data: null, error: asError(error) }
      : { data: { ok: true, supplier: data }, error: null };
  }

  const { data, error } = await supabase
    .from("suppliers")
    .insert(body.row as never)
    .select("*")
    .single();
  return error
    ? { data: null, error: asError(error) }
    : { data: { ok: true, supplier: data }, error: null };
}

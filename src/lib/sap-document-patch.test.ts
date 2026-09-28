import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFullDocumentPatch, buildFullPatchLines, mergeSapDocumentLines } from "../../supabase/functions/_shared/sap-line-merge";
import { enforceSapLinePrices } from "../../supabase/functions/_shared/sap-line-prices";

afterEach(() => vi.unstubAllGlobals());
const current = { DocEntry: 1, DocTotal: 100, DocDate: "2026-01-01", NumAtCard: "NF 123", U_Contract: "keep", DocumentLines: [
  { LineNum: 3, ItemCode: "OLD", Quantity: 1, UnitPrice: 0, Price: 0, CostingCode: "OLD_CC", ProjectCode: "OLD_PROJECT", WarehouseCode: "01", U_Custom: "keep", UoMEntry: 9 },
] };
const approved = { Comments: "edited and approved", DocDueDate: "2026-10-01", TaxDate: "2026-09-01", BPL_IDAssignedToInvoice: 1, DocumentLines: [
  { ItemCode: "NEW", Quantity: 2, UnitPrice: 506.5, DiscountPercent: 0, CostingCode: "NEW_CC", ProjectCode: "", FreeOfChargeBP: "tNO" },
] };
describe("SAP reapproval complete patch", () => {
 it("carries approved amounts, all lines and editable SAP fields, preserves line IDs and explicit clearing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(current)));
  const patch = await buildFullDocumentPatch("https://sap.invalid", "synthetic", "PurchaseOrders", 1, approved);
  expect(patch).toMatchObject({ Comments: approved.Comments, NumAtCard: "NF 123", U_Contract: "keep", DocDueDate: "2026-10-01" });
  expect(patch).not.toHaveProperty("DocTotal"); expect(patch).not.toHaveProperty("TaxDate");
  expect(patch.DocumentLines).toEqual([{ LineNum: 3, ItemCode: "NEW", Quantity: 2, UnitPrice: 506.5, Price: 506.5, DiscountPercent: 0, CostingCode: "NEW_CC", ProjectCode: "", FreeOfChargeBP: "tNO", WarehouseCode: "01", U_Custom: "keep" }]);
 });
 it("does not send incomplete data when SAP read fails", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", {status:503})));
  await expect(buildFullDocumentPatch("", "", "", 1, approved)).rejects.toThrow();
  await expect(buildFullPatchLines("", "", "", 1, approved.DocumentLines)).rejects.toThrow();
 });
 it("preserves gap IDs, removes omitted lines and lets SAP assign new line IDs", () => {
  const old=[{LineNum:3,ItemCode:"A"},{LineNum:8,ItemCode:"B"}];
  expect(mergeSapDocumentLines(old,[{ItemCode:"A",UnitPrice:5}])).toHaveLength(1);
  const lines=mergeSapDocumentLines(old,[{ItemCode:"A",UnitPrice:5},{ItemCode:"B",UnitPrice:6},{ItemCode:"C",UnitPrice:7}]);
  expect(lines[0].LineNum).toBe(3);expect(lines[1].LineNum).toBe(8);expect(lines[2]).not.toHaveProperty("LineNum");
 });
 it("corrects recalculated zero values after a full patch, then verifies the saved prices", async () => {
  let lines=[{LineNum:3,ItemCode:"NEW",Quantity:2,UnitPrice:0,Price:0}];const patches: any[]=[];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
   if(init?.method==="PATCH") { const payload=JSON.parse(init.body);patches.push(payload);lines=lines.map(l=>({...l,...payload.DocumentLines.find((x:any)=>x.LineNum===l.LineNum)}));return new Response(null,{status:204}); }
   return Response.json({DocumentLines:lines});
  }));
  expect(await enforceSapLinePrices("", "", "", 1, [{lineNum:3,unitPrice:506.5}])).toEqual({corrected:true});
  expect(patches[0].DocumentLines[0]).toEqual({LineNum:3,UnitPrice:506.5,Price:506.5,DiscountPercent:0});
  expect(lines[0].Quantity*lines[0].UnitPrice).toBe(1013);
 });
 it("fails if SAP omits a line instead of treating absence as success", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({DocumentLines:[]})));
  await expect(enforceSapLinePrices("", "", "", 1, [{lineNum:3,unitPrice:5}])).rejects.toThrow();
 });
 it("maps new line IDs by position and rejects prices SAP still refuses to persist", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url,init) => init?.method==="PATCH"?new Response(null,{status:204}):Response.json({DocumentLines:[{LineNum:9,UnitPrice:0}]})));
  await expect(enforceSapLinePrices("", "", "", 1, [{position:0,unitPrice:5}])).rejects.toThrow(/não gravou/);
 });
});

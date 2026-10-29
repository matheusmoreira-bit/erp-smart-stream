import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sha256 } from "npm:@noble/hashes@1.8.0/sha256";
import { requireSchedulerOrAdmin } from "../_shared/automation-auth.ts";
import { tryWatcherLock, releaseWatcherLock } from "../_shared/watcher-lock.ts";
import { CATALOG, EXCLUDED } from "./catalog.ts";
import { SHARED_DRIVE, ROOT_NAME, PENDING_BUCKETS, sanitize, csvRows, csvCell, safeSegment, canComplete } from "./core.ts";
import { drive, folder, putSmall, startUpload, uploadPart, DriveError } from "./drive.ts";

const NAME = "export-to-gdrive";
const cors = { "Access-Control-Allow-Origin":"https://erp-flow.cactuscorporation.com", "Access-Control-Allow-Headers":"authorization,content-type,x-scheduler-secret" };
type Row = Record<string,unknown>;
type HashState = { values:Record<string,unknown>; buffer:number[] };
type FileState = { path:string; chunks:number; rows:number; bytes:number; hash?:string; hashState?:HashState; upload?:string; offset?:number; id?:string; status:"staging"|"pending"|"complete"; json:boolean; binary?:boolean };
type State = { table:number; last?:Row; root?:string; account?:string; files:FileState[]; cycle:string; tablesDone:boolean; errors:string[]; uploadedBytes:number; uploadedFiles:number; phase:string; };
const encoder = new TextEncoder();
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{ status, headers:{...cors,"Content-Type":"application/json"} });
function sbClient() {
  const url=Deno.env.get("SUPABASE_URL"); const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Configuration backend absente");
  return createClient(url,key);
}
type SB = ReturnType<typeof sbClient>;
async function save(sb:SB,state:State) {
  const {error}=await sb.from("gdrive_export_state").upsert({singleton:true,cycle_started_at:state.cycle,state,updated_at:new Date().toISOString()});
  if(error) throw new Error("Impossible de sauvegarder le curseur");
}
function hashText(f:FileState,text:string,raw?:Uint8Array) {
  const hash=sha256.create();
  if(f.hashState) {
    const h=hash as unknown as Record<string,unknown>;
    for(const [k,v] of Object.entries(f.hashState.values)) h[k]=v;
    (h.buffer as Uint8Array).set(f.hashState.buffer);
  }
  const bytes=raw || encoder.encode(text); hash.update(bytes); f.bytes+=bytes.length;
  const h=hash as unknown as Record<string,unknown>; const values:Record<string,unknown>={};
  for(const [k,v] of Object.entries(h)) if(typeof v==="number" || typeof v==="boolean") values[k]=v;
  f.hashState={values,buffer:Array.from(h.buffer as Uint8Array)};
  f.hash=Array.from(hash.clone().digest()).map(v=>v.toString(16).padStart(2,"0")).join("");
}
async function append(sb:SB,f:FileState,text:string) {
  const {error}=await sb.from("gdrive_export_chunks").upsert({path:f.path,chunk_no:f.chunks,content:text});
  if(error) throw new Error("Falha ao persistir lote de exportação");
  f.chunks++; hashText(f,text);
}
async function gzipAppend(sb:SB,f:FileState,text:string) {
  const stream=new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes=new Uint8Array(await new Response(stream).arrayBuffer());
  let encoded="";for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.slice(i,i+8192));
  const {error}=await sb.from("gdrive_export_chunks").upsert({path:f.path,chunk_no:f.chunks,content:btoa(encoded)});
  if(error)throw new Error("Falha ao persistir auditoria compactada");
  f.binary=true;f.chunks++;hashText(f,"",bytes);
}
function file(state:State,path:string,jsonFile:boolean):FileState {
  let f=state.files.find(f=>f.path===path);
  if(!f) { f={path,chunks:0,rows:0,bytes:0,status:"staging",json:jsonFile}; state.files.push(f); }
  return f;
}
function filterLiteral(value:unknown):string {
  if(typeof value==="number" || typeof value==="boolean") return String(value);
  if(typeof value!=="string") throw new Error("Chave de paginação não suportada");
  return '"'+value.replace(/\\/g,"\\\\").replace(/"/g,'\\"')+'"';
}
async function companyFor(sb:SB,row:Row):Promise<string> {
  const company=row.company_db || row.sap_company_db || row.source_company_db;
  if(typeof company==="string" && company) return company;
  const refs=[ ["expense_id","expenses"],["advance_payment_id","advance_payments"],["batch_id","accounts_payable_batches"],["request_id","registration_requests"] ];
  for(const [column,table] of refs) if(typeof row[column]==="string") {
    const {data,error}=await sb.from(table).select("company_db").eq("id",row[column]).maybeSingle();
    if(error) throw new Error("Falha ao relacionar empresa do documento");
    if(data?.company_db) return String(data.company_db);
  }
  return "_global";
}
async function tablePage(sb:SB,state:State) {
  const spec=CATALOG[state.table]; if(!spec) {state.tablesDone=true;state.phase="upload";return;}
  let query=sb.from(spec.table).select(spec.columns.join(","));
  for(const key of spec.order) query=query.order(key,{ascending:true});
  if(spec.columns.includes("created_at" as never)) query=query.lte("created_at",state.cycle);
  if(state.last) {
    const last=state.last;
    const clauses=spec.order.map((key,i)=>{
      const terms=spec.order.slice(0,i).map(previous=>`${previous}.eq.${filterLiteral(last[previous])}`);
      terms.push(`${key}.gt.${filterLiteral(last[key])}`);
      return terms.length>1 ? `and(${terms.join(",")})` : terms[0];
    });
    query=query.or(clauses.join(","));
  }
  const {data,error}=await query.limit(200);
  if(error) throw new Error(`Falha ao ler tabela ${spec.table}`);
  const rows=(data || []) as Row[];
  const groups=new Map<string,Row[]>();
  for(const row of rows) {
    if((spec.table==="audit_trail" || spec.table==="audit_trail_archive") && /credential|token|session|api_keys|auth\./i.test(String(row.table_name || ""))) continue;
    const company=await companyFor(sb,row); const group=groups.get(company)||[];
    group.push(sanitize(row) as Row);groups.set(company,group);
  }
  if(rows.length===0 && !state.last) groups.set("_global",[]);
  for(const [company,items] of groups) {
    const base=`dados/${safeSegment(company)}/${spec.table}`;
    const cf=file(state,base+".csv",false); const jf=file(state,base+".json",true);
    if(cf.chunks===0) await append(sb,cf,"\uFEFF"+spec.columns.map(csvCell).join(";")+"\r\n");
    if(jf.chunks===0) await append(sb,jf,"[");
    await append(sb,cf,csvRows(items,spec.columns));
    await append(sb,jf,items.map((r,i)=>(jf.rows+i>0?",":"")+JSON.stringify(r)).join(""));
    cf.rows+=items.length;jf.rows+=items.length;
    if(spec.table==="sap_archive_documents" || spec.table==="sap_archive_master_data") {
      const alias=file(state,`arquivo-sap/${safeSegment(company)}/${spec.table==="sap_archive_documents"?"documentos":"cadastros"}.csv`,false);
      if(alias.chunks===0)await append(sb,alias,"\uFEFF"+spec.columns.map(csvCell).join(";")+"\r\n");
      await append(sb,alias,csvRows(items,spec.columns));alias.rows+=items.length;
    }
    if(spec.table==="audit_trail" || spec.table==="audit_trail_archive") {
      const months=new Map<string,Row[]>();
      for(const item of items) {const month=String(item.ts || "").slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))throw new Error("Data de auditoria inválida");const list=months.get(month)||[];list.push(item);months.set(month,list);}
      const columns=["id","ts","actor_id","actor_email","actor_role","schema_name","table_name","op","row_pk","old_data","new_data","changed_cols","prev_hash","row_hash","app_context"];
      for(const [month,list] of months) {
        const audit=file(state,`auditoria/audit_trail-${month}.csv.gz`,false);
        const text=(audit.chunks===0?"\uFEFF"+columns.map(csvCell).join(";")+"\r\n":"")+csvRows(list,columns);
        await gzipAppend(sb,audit,text);audit.rows+=list.length;
      }
    }
  }
  if(rows.length) state.last=rows[rows.length-1];
  if(rows.length<200) {
    const files=state.files.filter(f=>f.status==="staging" && (f.path.endsWith(`/${spec.table}${f.json ? ".json" : ".csv"}`) || (spec.table==="sap_archive_documents" && f.path.endsWith("/documentos.csv")) || (spec.table==="sap_archive_master_data" && f.path.endsWith("/cadastros.csv"))));
    for(const f of files) {if(f.json) await append(sb,f,"]"); f.status="pending";f.hashState=undefined;}
    if(spec.table==="audit_trail_archive")for(const f of state.files.filter(f=>f.path.endsWith(".csv.gz"))){f.status="pending";f.hashState=undefined;}
    state.table++;state.last=undefined;
  }
  await save(sb,state);
}
async function cryptoKey():Promise<CryptoKey> {
  const source=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!source)throw new Error("Chave de proteção indisponível");
  return crypto.subtle.importKey("raw",await crypto.subtle.digest("SHA-256",encoder.encode(source)),"AES-GCM",false,["encrypt","decrypt"]);
}
async function seal(value:string):Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(),encoder.encode(value)));
  return btoa(String.fromCharCode(...iv,...encrypted));
}
async function unseal(value:string):Promise<string> {
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,12)},await cryptoKey(),bytes.slice(12)));
}
async function uploadStep(sb:SB,state:State,f:FileState) {
  if(!state.root || !f.hash) throw new Error("Arquivo ainda não preparado");
  if(!f.upload) {
    const start=await startUpload(f.path,state.root,f.bytes,f.hash);
    if(start.skipped) { f.id=start.id;f.status="complete";await save(sb,state);return; }
    f.upload=await seal(start.url);f.offset=0;await save(sb,state);
  }
  const offset=f.offset||0;const count=Math.min(262144,f.bytes-offset);
  const body=new Uint8Array(count);let sourceOffset=0;let copied=0;
  for(let chunk=0;chunk<f.chunks && copied<count;chunk++) {
    const {data,error}=await sb.from("gdrive_export_chunks").select("content").eq("path",f.path).eq("chunk_no",chunk).single();
    if(error)throw new Error("Lote de arquivo indisponível");
    const bytes=f.binary?Uint8Array.from(atob(data.content),c=>c.charCodeAt(0)):encoder.encode(data.content);
    if(sourceOffset+bytes.length>offset) {
      const begin=Math.max(0,offset-sourceOffset);const part=bytes.slice(begin,begin+count-copied);body.set(part,copied);copied+=part.length;
    }
    sourceOffset+=bytes.length;
  }
  if(copied!==count)throw new Error("Tamanho de lote inconsistente");
  let result;
  try {result=await uploadPart(await unseal(f.upload),body,offset,f.bytes);}
  catch(e) {if(e instanceof DriveError && (e.status===404 || e.status===410)){f.upload=undefined;f.offset=0;await save(sb,state);}throw e;}
  f.offset=result.offset;
  if(result.id) {
    const info=await drive(`/drive/v3/files/${result.id}?fields=id,size,appProperties`);
    if(Number(info.size)!==f.bytes || (info.appProperties as Record<string,string>)?.sha256!==f.hash)throw new Error("Verificação do arquivo enviado falhou");
    f.id=result.id;f.status="complete";f.upload=undefined;state.uploadedFiles++;state.uploadedBytes+=f.bytes;
  }
  await save(sb,state);
}
let attachmentsDone=false;
function publicManifest(state:State,sapDone:boolean) {
  if(attachmentsDone) return {...publicManifestBase(state,sapDone),attachments_status:"concluido",attachment_pending:[]};
  return publicManifestBase(state,sapDone);
}
function publicManifestBase(state:State,sapDone:boolean) {
  return {origin:"ERP Flow",cutoff:state.cycle,status:canComplete(state.tablesDone,sapDone,PENDING_BUCKETS.length,state.errors.length)?"completo":"em andamento", tables_done:state.tablesDone,sap_complete:sapDone, account:state.account, files:state.files.map(({path,rows,bytes,hash,status,id})=>({path,rows,bytes,sha256:hash,status,id})), excluded:EXCLUDED, reviewed_catalog:CATALOG.map(s=>({table:s.table,excluded_columns:s.excluded_columns,review_required:s.review})), attachment_pending:PENDING_BUCKETS.map(bucket=>({bucket,status:"pendente",reason:"Cópia administrativa de Storage em backup integral não permitida pelas instruções da plataforma"})), errors:state.errors, transactional_snapshot:false};
}
async function run(sb:SB,manual:boolean):Promise<Row> {
  const started=Date.now();let state:State|undefined;let logId:string|undefined;let failure:string|undefined;
  const locked=await tryWatcherLock(sb,NAME,5);if(!locked)return {skipped:true,reason:"Execução em andamento"};
  try {
    const {data,error}=await sb.from("gdrive_export_state").select("state").eq("singleton",true).maybeSingle();
    if(error)throw new Error("Falha ao carregar cursor");
    {const {data:n}=await sb.from("gdrive_attachment_notice_state").select("completed_at").eq("singleton",true).maybeSingle();attachmentsDone=!!n?.completed_at;}
    state=data?.state as State|undefined;
    if(!state)state={table:0,cycle:new Date().toISOString(),tablesDone:false,files:[],errors:[],uploadedBytes:0,uploadedFiles:0,phase:"tables"};
    if(state.tablesDone && state.files.every(f=>f.status==="complete") && state.cycle.slice(0,10)!==new Date().toISOString().slice(0,10)) {
      const {error}=await sb.from("gdrive_export_chunks").delete().gte("chunk_no",0);
      if(error)throw new Error("Falha ao reiniciar ciclo de exportação");
      state={table:0,cycle:new Date().toISOString(),tablesDone:false,files:[],errors:[],uploadedBytes:0,uploadedFiles:0,phase:"tables"};
    }
    const {data:log,error:logError}=await sb.from("infra_backup_log").insert({kind:"db",status:"running",trigger:manual?"manual":"cron",bucket:"google-drive",manifest:{destination:SHARED_DRIVE}}).select("id").single();
    if(logError)throw new Error("Falha ao registrar execução de backup");logId=String(log.id);
    const {error:settingsError}=await sb.from("gdrive_backup_settings").update({run_status:"running",run_started_at:new Date().toISOString(),run_error:null,run_trigger:manual?"manual":"cron"}).eq("singleton",true);
    if(settingsError)throw new Error("Falha ao registrar progresso");
    const about=await drive("/drive/v3/about?fields=user(emailAddress)");state.account=String((about.user as Row)?.emailAddress || "");
    const {data:settings}=await sb.from("gdrive_backup_settings").select("folder_id").eq("singleton",true).single();
    if(settings?.folder_id!==SHARED_DRIVE)throw new Error("Destino compartilhado não configurado");
    state.root=await folder(ROOT_NAME,SHARED_DRIVE);
    state.errors=[];await save(sb,state);
    for(const name of ["dados","arquivo-sap","indices","auditoria","anexos-pedidos-flow","outros-anexos"]) await folder(name,state.root);
    await putSmall("indices/anexos.csv",state.root,"\uFEFFbucket;caminho_original;caminho_drive;empresa;documento_pedido;sha256;bytes;status\r\n"+PENDING_BUCKETS.map(b=>`${b};;;;;;;pendente`).join("\r\n")+"\r\n","text/csv");
    const readme=`ERP FLOW — BACKUP DE SAÍDA\nOrigem: tabelas de negócio public do ERP Flow. Corte do ciclo: ${state.cycle}.\nNão é snapshot transacional. Registros alterados durante a exportação podem refletir momentos distintos.\nDados: CSV UTF-8 BOM, separador ; e JSON. Empresas sem vínculo conhecido ficam em _global, sem exclusão de linhas.\nRelacionar expense_attachments.expense_id com expenses.id; sap_archive_attachments com empresa, doc_type, doc_entry e storage_path.\nÍndice: anexos pendentes não possuem caminho final ou hash verificado.\nArquivo SAP: documentos e cadastros nas tabelas sap_archive_documents/master_data; aliases e auditoria compactada ainda pendentes.\nAnexos: ${PENDING_BUCKETS.join(", ")} pendentes; cópia administrativa automática de Storage para backup integral não permitida pelas instruções da plataforma.\nBackup integral restaurável separado: More → Database → Manage → Settings → Export project data. Não inclui Storage, funções, segredos ou configuração dos provedores.\nCredenciais, tokens, contas de autenticação e sessões NÃO são exportados. Campos JSON sensíveis são removidos; fórmulas em CSV neutralizadas.\nTabelas excluídas:\n${EXCLUDED.map(e=>`${e.table}: ${e.reason}`).join("\n")}\nColunas excluídas: ${CATALOG.filter(e=>e.excluded_columns.length).map(e=>e.table+": "+e.excluded_columns.join(",")).join("; ")}\nTabelas ambíguas estão marcadas review_required no manifest.\n`;
    await putSmall("LEIA-ME.txt",state.root,readme,"text/plain; charset=utf-8");
    await putSmall("manifest.json",state.root,JSON.stringify(publicManifest(state,false),null,2),"application/json");
    const deadline=Date.now()+65_000;
    while(Date.now()<deadline) {
      if(!state.tablesDone)await tablePage(sb,state);
      else {
        const pending=state.files.find(f=>f.status==="pending");
        if(!pending)break;
        await uploadStep(sb,state,pending);
      }
    }
    await putSmall("manifest.json",state.root,JSON.stringify(publicManifest(state,false),null,2),"application/json");
    return {account:state.account,root:state.root,files_uploaded:state.uploadedFiles,bytes_uploaded:state.uploadedBytes,tables_staged:state.table,total_tables:CATALOG.length,status:"partial",attachment_pending:PENDING_BUCKETS};
  }catch(e){failure=e instanceof DriveError?e.message:e instanceof Error?e.message:"Falha de backup";if(state){state.errors=[failure];await save(sb,state);}return {status:"error",error:failure};}
  finally {
    const summary={tables_count:state?.table || 0,objects_count:state?.uploadedFiles || 0,total_bytes:state?.uploadedBytes || 0};
    const {error}=await sb.from("gdrive_backup_settings").update({run_status:failure?"error":"partial",run_progress:failure || `${summary.tables_count}/${CATALOG.length} tabelas; ${summary.objects_count} arquivos enviados`,run_error:failure || null,run_finished_at:new Date().toISOString()}).eq("singleton",true);
    if(error)console.error("Falha ao persistir estado do backup Drive");
    if(logId){const {error}=await sb.from("infra_backup_log").update({...summary,status:failure?"error":"partial",finished_at:new Date().toISOString(),duration_ms:Date.now()-started,error_message:failure || null,manifest:{destination:SHARED_DRIVE,phase:state?.phase,attachment_pending:PENDING_BUCKETS}}).eq("id",logId);if(error)console.error("Falha ao finalizar registro de backup Drive");}
    await releaseWatcherLock(sb,NAME,failure?"error":"ok",failure || "Lote concluído; backup ainda incompleto");
  }
}
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Método inválido"},405);
  const gate=await requireSchedulerOrAdmin(req,cors);if(!gate.ok)return gate.response;
  let body:unknown;try{body=await req.json();}catch{return json({error:"JSON inválido"},400);}
  if(!body || typeof body!=="object" || Array.isArray(body) || Object.keys(body).some(k=>!["action","manual"].includes(k)))return json({error:"Parâmetros inválidos"},400);
  const args=body as Row;if(args.action!==undefined && args.action!=="run")return json({error:"Ação inválida"},400);
  return json(await run(sbClient(),args.manual===true));
});
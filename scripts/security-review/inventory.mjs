// Static inventory only: a missing literal guard is a review lead, not proof of exposure.
import {readdir,readFile} from 'node:fs/promises';
const root=new URL('../../',import.meta.url),dir=new URL('supabase/functions/',root);
const records=[];
for(const entry of await readdir(dir,{withFileTypes:true})){
 if(!entry.isDirectory()||entry.name.startsWith('_'))continue;
 const path=`supabase/functions/${entry.name}/index.ts`;let text;
 try{text=await readFile(new URL(path,root),'utf8');}catch{continue;}
 records.push({name:entry.name,path,guards:[...new Set(text.match(/\b(?:require(?:Admin\w*|User\w*|Integration\w*)|authorizeIntegrationCompany|auth\.getUser|auth\.getClaims|verifyJwt|verifyJWT)\b/g)||[])].sort(),
  hasServiceCredential:text.includes('SUPABASE_SERVICE_ROLE_KEY'),hasExternalFetch:/\b(?:fetch|sapFetch)\s*\(/.test(text),
  hasLiteralHttp:/["'`]http:\/\/(?!localhost|127\.0\.0\.1)/.test(text)});
}
console.log(JSON.stringify({method:'static source inventory; indirect guards, gateway and deployment not validated',count:records.length,functions:records.sort((a,b)=>a.name.localeCompare(b.name))},null,2));

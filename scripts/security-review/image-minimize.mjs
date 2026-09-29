// Synthetic images generated and decoded by real Chrome; no external network.
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const bundled=await build({entryPoints:['supabase/functions/_shared/ai-minimize.ts'],bundle:true,write:false,format:'iife',globalName:'minimize'});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());await page.addScriptTag({content:bundled.outputFiles[0].text});
 const results=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const ctx=canvas.getContext('2d');ctx.fillStyle='#aabbcc';ctx.fillRect(0,0,8,8);
  const encode=s=>new TextEncoder().encode(s);const cat=(...xs)=>{const out=new Uint8Array(xs.reduce((n,x)=>n+x.length,0));let p=0;for(const x of xs){out.set(x,p);p+=x.length;}return out;};
  const riffChunk=(name,payload)=>{const x=new Uint8Array(8+payload.length+(payload.length%2));x.set(encode(name));new DataView(x.buffer).setUint32(4,payload.length,true);x.set(payload,8);return x;};
  const secret=encode('SYNTHETIC_GPS_PRIVATE');const result=[];
  for(const mime of ['image/jpeg','image/png','image/webp']){
   const original=Uint8Array.from(atob(canvas.toDataURL(mime).split(',')[1]),c=>c.charCodeAt(0));let dirty;
   if(mime==='image/jpeg'){const len=secret.length+2;dirty=cat(original.slice(0,2),new Uint8Array([255,225,len>>8,len&255]),secret,original.slice(2));}
   if(mime==='image/png'){const chunk=new Uint8Array(12+secret.length);new DataView(chunk.buffer).setUint32(0,secret.length);chunk.set(encode('tEXt'),4);chunk.set(secret,8);dirty=cat(original.slice(0,33),chunk,original.slice(33));}
   if(mime==='image/webp'){
    let data=original.slice(12);const head=new Uint8Array(10);head[0]=12;head[4]=7;head[7]=7;
    if(String.fromCharCode(...data.slice(0,4))==='VP8X')data[8]|=12;else data=cat(riffChunk('VP8X',head),data);
    dirty=cat(original.slice(0,12),data,riffChunk('EXIF',secret),riffChunk('XMP ',secret));new DataView(dirty.buffer).setUint32(4,dirty.length-8,true);
   }
   dirty=cat(dirty,secret); // Trailing application metadata must not leave the server either.
   const clean=minimize.stripImageMetadata(dirty,mime);
   const contains=new TextDecoder().decode(clean).includes('SYNTHETIC_GPS_PRIVATE');
   const image=await createImageBitmap(new Blob([clean],{type:mime}));
   const rendered=document.createElement('canvas');rendered.width=rendered.height=8;const rc=rendered.getContext('2d');rc.drawImage(image,0,0);const pixel=[...rc.getImageData(0,0,1,1).data];image.close();
   let rejected=false;try{minimize.stripImageMetadata(dirty.slice(0,10),mime);}catch{rejected=true;}
   result.push({mime,metadataRemoved:!contains,dimensions:[rendered.width,rendered.height],pixel,truncatedRejected:rejected});
  }
  return result;
 });
 for(const r of results){assert.equal(r.metadataRemoved,true);assert.equal(r.truncatedRejected,true);assert.deepEqual(r.dimensions,[8,8]);assert.ok(Math.abs(r.pixel[0]-170)<8);}
 console.log(JSON.stringify({browser:await browser.version(),environment:'synthetic image containers and real browser decoding',tests:results},null,2));
}finally{await browser.close();}

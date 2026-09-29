// Render the authored local report; external network is disabled.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url);
const stem=process.argv[2] || 'ERP_Flow_Cyber_Assessment_V4.2';
if(!/^[A-Za-z0-9_.-]+$/.test(stem))throw Error('Invalid report filename');
const base=new URL('docs/reports/'+stem,root).pathname;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:794,height:1123},deviceScaleFactor:1});
 await page.route(/^https?:/,route=>route.abort());
 await page.goto('file://'+base+'.html');await page.emulateMedia({media:'print'});await page.evaluate(()=>document.fonts.ready);
 const layout=await page.locator('.page').evaluateAll(nodes=>nodes.map((el,i)=>({page:i+1,height:Math.round(el.getBoundingClientRect().height)})));
 // Measure at the printable width, not viewport width.
 await page.addStyleTag({content:'body{width:176mm}'});
 const measured=await page.locator('.page').evaluateAll(nodes=>nodes.map((el,i)=>({page:i+1,height:Math.round(el.getBoundingClientRect().height)})));
 const limit= (297-17-18)*96/25.4;
 if(measured.some(p=>p.height>limit))throw Error('Oversized sections: '+JSON.stringify(measured.filter(p=>p.height>limit)));
 const pdf=await page.pdf({path:base+'.pdf',format:'A4',printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:'<span></span>',footerTemplate:'<div style="width:100%;margin:0 17mm;font-size:8px;color:#627482;display:flex;justify-content:space-between"><span>ERP Flow · Segurança V4.2 · Confidencial · 28/09/2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'});
 const meta=JSON.parse(await readFile(base+'.integrity.json','utf8'));meta.layout=measured;meta.pdf_sha256=createHash('sha256').update(pdf).digest('hex');meta.html_sha256=createHash('sha256').update(await readFile(base+'.html')).digest('hex');meta.pdf_bytes=pdf.length;
 await writeFile(base+'.integrity.json',JSON.stringify(meta,null,2)+'\n');
 // Contact sheet built from section screenshots for visual review.
 for(const index of [...new Set([0,1,4,9,measured.length-1])])await page.locator('.page').nth(index).screenshot({path:'/tmp/erp-v42-report-page-'+(index+1)+'.png'});
 console.log(JSON.stringify({pdf:base+'.pdf',bytes:pdf.length,sections:measured},null,2));
}finally{await browser.close();}

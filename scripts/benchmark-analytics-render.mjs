import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const label=process.argv[2]||'before';const results=[];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-precise-memory-info','--js-flags=--expose-gc']});
try{
 const page=await browser.newPage();await page.setViewport({width:1280,height:900});
 await page.setContent('<html><body><div id="app"></div></body></html>');
 await page.addScriptTag({path:path.resolve('.verification/phase3d5',label,'bundle.js')});
 for(const size of [100,500,2000,5000]){
  const dataset=await page.evaluate(size=>window.prepare(size),size);
  for(const kind of ['line','bar','trend','volume','grouping']){
   const measures=await page.evaluate(async kind=>{
    const settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const rows=[];
    for(let repeat=0;repeat<4;repeat++){
     const start=performance.now();window.kind=kind;window.render(kind);await settle();
     const mountMs=performance.now()-start,mountReactMs=window.commits[0]?.duration;
     const staticDOM=document.getElementById('app').innerHTML;window.initialDOM=staticDOM;const nodeCount=document.getElementById('app').querySelectorAll('*').length;
     window.commits=[];const p=performance.now();window.parentUpdate();await settle();
     const parentMs=performance.now()-p,parentReactMs=window.commits.reduce((n,c)=>n+c.duration,0);
     const targets=[...document.querySelectorAll('#app [tabindex="0"]')];const interactions=[];
     for(let i=0;i<6&&targets.length;i++){
      window.commits=[];const start=performance.now();targets[Math.min(i,targets.length-1)].focus();await settle();
      interactions.push({frameMs:performance.now()-start,reactMs:window.commits.reduce((n,c)=>n+c.duration,0)});
     }
     if(repeat)rows.push({mountMs,mountReactMs,parentMs,parentReactMs,interactions,nodeCount,characters:staticDOM.length});
    }
    return rows;
   },kind);
   const cdp=await page.createCDPSession();const heap=await cdp.send('Runtime.getHeapUsage');await cdp.detach();
   const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
   const r={...dataset,kind,mountMs:median(measures.map(x=>x.mountMs)),mountReactMs:median(measures.map(x=>x.mountReactMs)),parentReactMs:median(measures.map(x=>x.parentReactMs)),focusReactMs:median(measures.flatMap(x=>x.interactions.map(i=>i.reactMs))),focusFrameMs:median(measures.flatMap(x=>x.interactions.map(i=>i.frameMs))),nodeCount:measures[0].nodeCount,characters:measures[0].characters,heapUsedBytes:heap.usedSize};
   fs.writeFileSync(path.resolve('.verification/phase3d5',label,size+'-'+kind+'.html'),await page.evaluate(()=>window.initialDOM));results.push(r);console.log(JSON.stringify(r));
  }
 }
 fs.writeFileSync(path.resolve('.verification/phase3d5',label+'.json'),JSON.stringify({label,browser:await browser.version(),viewport:{width:1280,height:900},method:'Production React profiling build. One warmup + three mounts, six focus updates per mount, two animation frames per settled measurement. Synthetic DTOs; no database/network.',results},null,2));
}finally{await browser.close();}

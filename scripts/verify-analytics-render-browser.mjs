import puppeteer from 'puppeteer-core';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
let checks=0;const verify=(value,label)=>{assert.ok(value,label);checks++;};
for(const size of [100,500,2000,5000])for(const kind of ['line','bar','trend','volume','grouping']){
 const file=size+'-'+kind+'.html';verify(fs.readFileSync('.verification/phase3d5/before/'+file,'utf8')===fs.readFileSync('.verification/phase3d5/after/'+file,'utf8'),'Exact original DOM '+file);
}
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const errors=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html data-theme="light"><body><div id="app" data-authenticated-theme></div></body></html>');
 for(const file of ['src/styles/theme.css','src/styles/globals.css'])await page.addStyleTag({content:fs.readFileSync(file,'utf8')});
 await page.addScriptTag({path:path.resolve('.verification/phase3d5/after/bundle.js')});
 const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.evaluate(()=>window.prepare(100));
 for(const kind of ['line','bar','trend','volume']){
  await page.evaluate(k=>{window.kind=k;window.render(k);},kind);await settle();
  const focus=await page.evaluate(()=>{const t=document.querySelector('#app [tabindex="0"]');window.savedPlot=document.querySelector('#app svg')??document.querySelector('#app [class*="chartFrame"]');const expected=t.getAttribute('aria-label');t.focus();return expected;});await settle();
  verify(await page.evaluate(text=>document.querySelector('[role="status"]')?.textContent===text,focus),kind+' keyboard detail');
  verify(await page.evaluate(()=>window.savedPlot===(document.querySelector('#app svg')??document.querySelector('#app [class*="chartFrame"]'))),kind+' stable chart DOM');
  await page.evaluate(()=>document.activeElement.blur());await settle();verify(await page.$('[role="status"]')===null,kind+' blur');
  await page.evaluate(()=>{window.props[window.kind]={...window.props[window.kind],points:[]};window.parentUpdate();});await settle();verify(await page.$('#app [tabindex="0"]')===null,kind+' empty update');
  await page.evaluate(()=>{window.prepare(100);window.parentUpdate();});await settle();verify(await page.$('#app [tabindex="0"]')!==null,kind+' data refresh');
 }
 await page.evaluate(()=>{window.kind='line';window.props.line={yLabel:'Avg',points:[{label:'Missing',value:null,tooltip:'Unavailable'}]};window.render('line');});await settle();verify(await page.$('#app svg')===null,'all-null Coach series stays empty');
 await page.evaluate(()=>{window.props.line={yLabel:'Avg',points:[{label:'Zero',value:0,tooltip:'Genuine zero'}]};window.parentUpdate();});await settle();verify(await page.$('#app circle[tabindex="0"]')!==null,'genuine zero remains visible');
 await page.evaluate(()=>{window.kind='grouping';window.render('grouping');});await settle();
 const tabs=await page.$$('#app button');
 for(const tab of tabs){await tab.click();await settle();verify(await tab.evaluate(el=>el.getAttribute('aria-pressed')==='true'),'grouping layout updates');}
 const layouts=[];
 for(const width of [320,390,768,1280])for(const theme of ['light','dark']){
  await page.setViewport({width,height:900});await page.evaluate(t=>document.documentElement.setAttribute('data-theme',t),theme);
  await page.evaluate(()=>{window.kind='workspace';window.render('workspace');});await settle();
  verify(await page.$('h2#overview-heading')!==null,'workspace overview at '+width+' '+theme);
  const before=await page.evaluate(()=>{window.savedGrouping=document.querySelector('[class*="groupingCanvas"] svg');return window.savedGrouping?.querySelectorAll('circle').length;});
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Weekly').click());await settle();
  verify(await page.evaluate(()=>window.savedGrouping===document.querySelector('[class*="groupingCanvas"] svg')),'unchanged grouping survives volume change');
  const metrics=await page.evaluate(()=>({pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,surface:getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim(),charts:document.querySelectorAll('svg').length}));layouts.push({width,theme,...metrics,groupingCircles:before});
  if(width===390&&theme==='dark'||width===1280&&theme==='light')await page.screenshot({path:path.resolve('.verification/phase3d5',`workspace-${width}-${theme}.png`),fullPage:true});
 }
 await page.evaluate(()=>{[...document.querySelectorAll('fieldset button')].find(b=>b.textContent==='All').click();});await settle();
 await page.evaluate(()=>{[...document.querySelectorAll('fieldset button')].find(b=>b.textContent==='All time').click();});await settle();
 verify(await page.evaluate(()=>document.querySelectorAll('[class*="trendList"] > div').length===window.props.trend.points.length),'All Time exposes every scored Round');
 verify(await page.evaluate(()=>[...document.querySelectorAll('fieldset button')].some(b=>b.textContent==='All time'&&b.getAttribute('aria-pressed')==='true')),'All Time filter remains interactive');
 verify(errors.length===0,'no browser runtime errors');
 fs.writeFileSync('.verification/phase3d5/browser-acceptance.json',JSON.stringify({checks,errors,layouts,scope:'Local synthetic actual components; not authenticated production or physical Android acceptance'},null,2));console.log(JSON.stringify({checks,errors,layouts}));
}finally{await browser.close();}

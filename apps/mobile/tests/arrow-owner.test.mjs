import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../src/arrow-writes.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(owner){
 let writes=0;
 const client={auth:{getSession:async()=>({data:{session:owner?{user:{id:owner}}:null},error:null})},rpc:()=>{writes++;return{single:async()=>({data:{id:'saved'},error:null})}}};
 const out={};new Function('require','exports',code)(name=>name==='./supabase'?{supabase:client}:{arrowWriteFields:()=>({})},out);
 return{...out,writes:()=>writes};
}
test('queued mobile Arrow saves reject logout or a different current account before calling the RPC',async()=>{
 for(const owner of [null,'other']){const f=fixture(owner);await assert.rejects(f.saveArrowRecord({arrow:1},'old-end',undefined,'owner'));await assert.rejects(f.deleteArrowRecord('old-arrow','old-end','owner'));assert.equal(f.writes(),0);}
 const f=fixture('owner');assert.equal(await f.saveArrowRecord({arrow:1},'end',undefined,'owner'),'saved');assert.equal(f.writes(),1);
});

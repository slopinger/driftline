import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const cwd=new URL('..',import.meta.url);
const run=(...args)=>spawnSync(process.execPath,['bin/driftline.mjs',...args],{cwd,encoding:'utf8'});
test('CLI CI exit statuses and JSON format',()=>{
 const r=run('examples/before.json','examples/after.json','--format','json');assert.equal(r.status,1);assert(JSON.parse(r.stdout).counts.breaking>=6);
 assert.equal(run('examples/before.json','examples/after.json','--fail-on','never').status,0);
 assert.equal(run('examples/before.json','examples/before.json').status,0);
 assert.equal(run('not-found.json','examples/after.json').status,2);
 assert.equal(run('examples/before.json','examples/after.json','--format','yaml').status,2);
});
test('CLI local source matching skips symlinks and hidden dependencies',()=>{
 const dir=mkdtempSync(join(tmpdir(),'driftline-'));
 try{writeFileSync(join(dir,'client.ts'),'listCustomers();\nfetch("/invoices");');mkdirSync(join(dir,'node_modules'));writeFileSync(join(dir,'node_modules','bad.ts'),'listCustomers()');symlinkSync(join(dir,'client.ts'),join(dir,'linked.ts'));writeFileSync(join(dir,'.hidden.ts'),'listCustomers()');
 const r=run('examples/before.json','examples/after.json','--source',dir,'--format','json');assert.equal(r.status,1);const report=JSON.parse(r.stdout);assert.equal(report.sourcesScanned,1);assert(report.findings.some(f=>f.hits.some(h=>h.file==='client.ts'&&h.line===1)));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI review threshold catches unresolved refs without claiming breaking',()=>{
 const dir=mkdtempSync(join(tmpdir(),'driftline-review-'));
 try{const spec={openapi:'3.0.3',paths:{'/x':{get:{responses:{'200':{$ref:'external.json'}}}}}};const file=join(dir,'ref.json');writeFileSync(file,JSON.stringify(spec));assert.equal(run(file,file).status,0);assert.equal(run(file,file,'--fail-on','review').status,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

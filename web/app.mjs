import {markdown} from './engine.mjs';
const $ = id => document.getElementById(id);
const revisions={before:0,after:0,sources:0};
let report = null, sources = [], worker = null, filter = 'breaking', selected = null, busy = false, demoGeneration = 0;
function node(tag, text, className) {const n = document.createElement(tag); if(text !== undefined)n.textContent=text;if(className)n.className=className;return n;}
function error(message) {$('error').textContent=message;$('error').hidden=!message;}
function invalidate() {
  ++demoGeneration; if(worker){worker.terminate();worker=null;}
  busy=false;$('analyze').disabled=false;report=null;$('results').hidden=true;
  $('status').textContent='Inputs changed. Analyze again to refresh the report.';error('');
}
function sourceSummary() {$('source-count').textContent=sources.length ? `${sources.length} source file${sources.length===1?'':'s'} · memory only` : 'Optional · locate candidate callers';$('clear-sources').hidden=!sources.length;}
async function readSpecFile(file, side) {
  if(!file)return;
  invalidate();const revision=++revisions[side];
  if(file.size>5*1024*1024){error('Spec file limit is 5 MiB.');return;}
  try {const text=await file.text();if(revision!==revisions[side])return;invalidate();$(side).value=text;$(`name-${side}`).textContent=file.name;}
  catch {error('Could not read this file. Try selecting it again.');}
}
for (const side of ['before','after']) {
  $(side).addEventListener('input',()=>{++revisions[side];invalidate();});
  $(`file-${side}`).addEventListener('change',event=>{readSpecFile(event.target.files[0],side);event.target.value='';});
  const drop=$(`drop-${side}`);
  drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragover');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
  drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('dragover');if(event.dataTransfer.files.length!==1){error('Drop one JSON file into each contract.');return;}readSpecFile(event.dataTransfer.files[0],side);});
}
$('sources').addEventListener('change',async event=>{
  const files=[...event.target.files];event.target.value='';invalidate();const revision=++revisions.sources;
  if(files.length>1000||files.some(f=>f.size>1024*1024)||files.reduce((n,f)=>n+f.size,0)>10*1024*1024){error('Source limit: 1,000 files, 1 MiB each, 10 MiB total.');return;}
  try {const loaded=await Promise.all(files.map(async f=>({name:f.webkitRelativePath||f.name,text:await f.text()})));if(revision!==revisions.sources)return;invalidate();sources=loaded.filter(f=>!f.text.includes('\0'));sourceSummary();}
  catch {error('Could not read one of the source files.');}
});
$('clear-sources').addEventListener('click',()=>{++revisions.sources;invalidate();sources=[];sourceSummary();});
function analyze() {
  if(busy)return;
  invalidate();busy=true;error('');$('analyze').disabled=true;$('status').textContent='Comparing contracts locally…';
  worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    worker.terminate();worker=null;busy=false;$('analyze').disabled=false;
    if(data.error){error(data.error);$('status').textContent='Analysis stopped. Fix the input and try again.';return;}
    report=data.report;filter=report.counts.breaking?'breaking':report.counts.review?'review':'all';selected=null;
    $('results').hidden=false;$('report-title').textContent=`${report.before.title} → ${report.after.version}`;
    $('report-subtitle').textContent=`${report.before.version} → ${report.after.version} / ${report.sourcesScanned} source files scanned`;
    for(const type of ['breaking','review','compatible'])$(`count-${type}`).textContent=report.counts[type];
    $('count-operations').textContent=new Set(report.findings.filter(f=>f.method!=='API').map(f=>`${f.method} ${f.path}`)).size;
    $('coverage').textContent=(report.incomplete?'ANALYSIS INCOMPLETE: finding limit reached. ':'')+report.coverage;
    $('status').textContent=`Analysis ready. ${report.findings.length} findings. Nothing uploaded or saved.`;render();
  };
  worker.onerror=()=>{if(worker)worker.terminate();worker=null;busy=false;$('analyze').disabled=false;error('Analysis could not finish. Try smaller inputs.');$('status').textContent='Analysis stopped.';};
  worker.postMessage({before:$('before').value,after:$('after').value,sources});
}
$('analyze').addEventListener('click',analyze);
function render() {
  if(!report)return;
  document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-pressed',String(b.dataset.filter===filter));});
  const query=$('search').value.toLowerCase();
  const visible=report.findings.filter(f=>(filter==='all'||f.severity===filter)&&`${f.path} ${f.title} ${f.location} ${f.operationId}`.toLowerCase().includes(query));
  $('findings-heading').textContent=`${filter==='all'?'All changes':filter==='breaking'?'Changes to act on':filter==='review'?'Changes to review':'Compatible changes'} (${visible.length})`;
  if(!visible.some(f=>f.id===selected))selected=visible[0]?.id;
  $('findings').replaceChildren();
  if(!visible.length)$('findings').append(node('p',report.findings.length?'No findings match this filter.':'No changes detected in the supported checks. Review coverage and run consumer tests.','empty'));
  for(const finding of visible) {
    const button=node('button',undefined,`finding${finding.id===selected?' selected':''}`);button.type='button';button.setAttribute('aria-pressed',String(finding.id===selected));
    button.append(node('span',finding.severity,`badge ${finding.severity}`),node('span',`${finding.hits.length} refs`,'ref-count'),node('span',`${finding.method} ${finding.path}`,'finding-route'),node('span',finding.title,'finding-title'));
    button.addEventListener('click',()=>{selected=finding.id;render();});$('findings').append(button);
  }
  detail(visible.find(f=>f.id===selected));
}
function detail(f) {
  const root=$('detail');root.replaceChildren();
  if(!f){root.append(node('p','Choose another filter or compare a different pair of contracts. No finding is a guarantee of compatibility.','empty'));return;}
  root.append(node('span',f.severity,`badge ${f.severity}`),node('p',`${f.method} ${f.path}`,'endpoint'),node('h3',f.title),node('p',f.location||'(operation)','location'));
  const diff=node('div',undefined,'diff');
  for(const [label,value] of [['BEFORE',f.before],['AFTER',f.after]]){const box=node('div');box.append(node('span',label),node('pre',value.length>6000?value.slice(0,6000)+'…':value));diff.append(box);}root.append(diff);
  const step=node('div',undefined,'next-step');step.append(node('h4','SUGGESTED NEXT STEP'),node('p',f.action));root.append(step);
  const refs=node('div',undefined,'references');refs.append(node('h4','CANDIDATE SOURCE REFERENCES'));
  if(!sources.length)refs.append(node('p','Add client source files above and re-analyze to locate endpoint strings and SDK operation names.'));
  else if(!f.hits.length)refs.append(node('p','No textual references found. Dynamic URLs, generated clients and indirect calls may still be affected.'));
  else {
    refs.append(node('p','Text matches to investigate, not confirmed callers.'));
    for(const hit of f.hits){const box=node('div',undefined,'reference');box.append(node('strong',`${hit.file}:${hit.line} · ${hit.match}`),node('code',hit.excerpt));refs.append(box);}
    if(f.hitsTruncated)refs.append(node('p','Only the first 100 matches are shown.'));
  }
  root.append(refs);
}
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{filter=button.dataset.filter;selected=null;render();});
$('search').addEventListener('input',render);
function download(text,name,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=node('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-md').addEventListener('click',()=>{if(report)download(markdown(report),'driftline-migration.md','text/markdown');});
$('export-json').addEventListener('click',()=>{if(report)download(JSON.stringify(report,null,2)+'\n','driftline-report.json','application/json');});
async function loadDemo() {
  ++revisions.before;++revisions.after;++revisions.sources;
  invalidate();const generation=demoGeneration;$('status').textContent='Loading the synthetic Orbit API example…';
  try {const response=await fetch(new URL('./demo.json',import.meta.url));if(!response.ok)throw new Error();const demo=await response.json();if(generation!==demoGeneration)return;
    $('before').value=JSON.stringify(demo.before,null,2);$('after').value=JSON.stringify(demo.after,null,2);$('name-before').textContent='orbit-2026.09.json · example';$('name-after').textContent='orbit-2026.10.json · example';sources=demo.sources;sourceSummary();$('search').value='';analyze();
  } catch {error('Example unavailable. You can still paste your own OpenAPI JSON.');$('status').textContent='Ready for your contracts.';}
}
$('load-demo').addEventListener('click',loadDemo);loadDemo();

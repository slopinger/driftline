// Optional browser QA: npm/playwright installation is intentionally external to this dependency-free project.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||undefined,headless:true,args:['--no-sandbox']});
const base=process.env.BASE_URL||'http://127.0.0.1:8891/';
const errors=[];const requests=[];
await mkdir('artifacts',{recursive:true});
try{
 for(const width of [1280,390,320]){
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.goto(base);await page.locator('#results').waitFor({state:'visible'});
  assert(Number(await page.locator('#count-breaking').textContent())>=6);
  assert.equal(await page.locator('#source-count').textContent(),'1 source file · memory only');
  assert(await page.locator('.finding.selected').count());
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`);
  await page.locator('[data-filter="compatible"]').click();assert.equal(await page.locator('.finding .badge.breaking').count(),0);
  await page.locator('[data-filter="all"]').click();await page.locator('#search').fill('currency');assert((await page.locator('.finding').count())>0);
  await page.locator('#search').fill('not-an-endpoint');assert.equal(await page.locator('.finding').count(),0);await page.locator('#search').fill('');
  const download=page.waitForEvent('download');await page.locator('#export-json').click();assert.equal((await download).suggestedFilename(),'driftline-report.json');
  await page.screenshot({path:`artifacts/workspace-${width}.png`,fullPage:true});
  if(width===1280){
   await page.locator('#before').fill('bad json');assert.equal(await page.locator('#results').isVisible(),false);await page.locator('#analyze').click();await page.locator('#error').waitFor({state:'visible'});assert((await page.locator('#error').textContent()).includes('invalid JSON'));
   await page.locator('#load-demo').click();await page.locator('#results').waitFor({state:'visible'});
   const before=JSON.parse(await page.locator('#before').inputValue());const after=structuredClone(before);after.paths={'/<img src=x onerror=alert(1)>':{get:{responses:{'200':{description:'x'}}}}};
   await page.locator('#after').fill(JSON.stringify(after));await page.locator('#analyze').click();await page.locator('#results').waitFor({state:'visible'});await page.locator('[data-filter="all"]').click();assert.equal(await page.locator('.finding img').count(),0);
   await page.locator('#clear-sources').click();assert((await page.locator('#source-count').textContent()).includes('Optional'));
   await page.locator('#sources').setInputFiles({name:'local.ts',mimeType:'text/plain',buffer:Buffer.from('listCustomers();')});await page.waitForFunction(()=>document.querySelector('#source-count').textContent.includes('1 source file'));await page.locator('#analyze').click();await page.locator('#results').waitFor({state:'visible'});
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith(base)),`Unexpected outbound requests: ${requests.filter(url=>!url.startsWith(base))}`);
 console.log('Browser QA passed: desktop/mobile, worker, filters, file input, invalidation, export, untrusted text, no external requests.');
}finally{await browser.close();}

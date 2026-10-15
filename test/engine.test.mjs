import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseSpec, compareSpecs, attachSources, markdown} from '../web/engine.mjs';
const spec = () => ({
  openapi: '3.0.3', info: {title: 'Test', version: '1'},
  paths: {'/pets': {get: {operationId: 'listPets', responses: {
    '200': {description: 'OK', content: {'application/json': {schema: {
      type: 'object', required: ['name'], properties: {name: {type: 'string'}}
    }}}}
  }}}}
});
function pair(change) {const a=spec(),b=structuredClone(a);change(b,a);return compareSpecs(a,b);}
const response = s => s.paths['/pets'].get.responses['200'].content['application/json'].schema;
const rules = r => r.findings.map(f=>f.rule);
test('unchanged spec does not mutate or find changes',()=>{const a=spec();assert.deepEqual(compareSpecs(a,a).counts,{breaking:0,review:0,compatible:0});assert.equal(a.paths['/pets'].get.operationId,'listPets');});
test('validates JSON, version and paths',()=>{for(const v of ['x','null','{}','{"openapi":"2.0","paths":{}}','{"openapi":"3.1.0","paths":[]}'])assert.throws(()=>parseSpec(v));assert.equal(parseSpec(JSON.stringify({...spec(),openapi:'3.1.2'})).openapi,'3.1.2');});
test('operation removal and addition',()=>{assert(rules(pair(s=>delete s.paths['/pets'].get)).includes('operation-removed'));assert(rules(pair(s=>s.paths['/new']={get:{responses:{}}})).includes('operation-added'));});
test('request enum narrowing vs response expansion',()=>{const r=pair((b,a)=>{response(a).properties.name.enum=['a'];response(b).properties.name.enum=['a','b'];});assert(r.findings.some(f=>f.rule==='schema-enum'&&f.severity==='breaking'));});
test('response narrowing compatible',()=>{const r=pair((b,a)=>{response(a).properties.name.enum=['a','b'];response(b).properties.name.enum=['a'];});assert.equal(r.counts.breaking,0);assert(r.counts.compatible);});
test('required response guarantee removed',()=>assert(rules(pair(s=>response(s).required=[])).includes('response-required')));
test('removed optional response property still breaks access',()=>{const r=pair((b,a)=>{response(a).required=[];response(b).required=[];delete response(b).properties.name;});assert(r.findings.some(f=>f.rule==='property-removed'&&f.severity==='breaking'));});
test('new optional request field compatible, required field breaks',()=>{const r=pair((b,a)=>{for(const s of [a,b])s.paths['/pets'].get.requestBody={content:{'application/json':{schema:{type:'object',properties:{}}}}};const q=b.paths['/pets'].get.requestBody.content['application/json'].schema;q.properties.token={type:'string'};q.required=['token'];});assert(rules(r).includes('request-required'));});
test('inherited parameter overridden by operation',()=>{const r=pair((b,a)=>{for(const s of [a,b]){s.paths['/pets'].parameters=[{name:'q',in:'query',required:true,schema:{type:'string'}}];s.paths['/pets'].get.parameters=[{name:'q',in:'query',required:false,schema:{type:'string'}}];}});assert.equal(r.findings.length,0);});
test('new required header breaks',()=>assert(rules(pair(b=>b.paths['/pets'].get.parameters=[{name:'X-Key',in:'header',required:true,schema:{type:'string'}}])).includes('parameter-added')));
test('response number widens integer breaking; request number accepts integer',()=>{let r=pair((b,a)=>{response(a).properties.name.type='integer';response(b).properties.name.type='number';});assert.equal(r.counts.breaking,1);r=pair((b,a)=>{for(const s of[a,b])s.paths['/pets'].get.parameters=[{name:'q',in:'query',schema:{type:s===a?'integer':'number'}}];});assert.equal(r.counts.breaking,0);});
test('response nullable expansion breaks',()=>assert.equal(pair(b=>response(b).properties.name.nullable=true).counts.breaking,1));
test('local refs resolved in properties',()=>{const r=pair((b,a)=>{for(const s of[a,b]){s.components={schemas:{Name:{type:s===a?'string':'number'}}};response(s).properties.name={$ref:'#/components/schemas/Name'};}});assert.equal(r.counts.breaking,1);});
test('recursive local refs terminate and still find changed property',()=>{const r=pair((b,a)=>{for(const s of[a,b]){s.components={schemas:{Pet:response(s)}};response(s).properties.self={$ref:'#/components/schemas/Pet'};}response(b).properties.name.type='number';});assert.equal(r.counts.breaking,1);});
test('external and dangling refs require review even if unchanged',()=>{for(const ref of ['https://example.test/schema','#/missing']){const r=pair((b,a)=>{response(a).properties.name={$ref:ref};response(b).properties.name={$ref:ref};});assert.equal(r.counts.review,1);}});
test('JSON pointer escapes work and prototype refs cannot escape own properties',()=>{const r=pair((b,a)=>{for(const s of[a,b]){s.components={schemas:{'a/b~c':{type:s===a?'string':'number'}}};response(s).properties.name={$ref:'#/components/schemas/a~1b~0c'};}});assert.equal(r.counts.breaking,1);const x=pair((b,a)=>{for(const s of[a,b])response(s).properties.name={$ref:'#/toString'};});assert.equal(x.counts.review,1);});
test('composition reports limited coverage even unchanged',()=>{const r=pair((b,a)=>{for(const s of[a,b])response(s).properties.name={oneOf:[{type:'string'},{type:'integer'}]};});assert(r.counts.review);});
test('auth inherited changes and scheme changes reviewed',()=>{const r=pair((b,a)=>{for(const s of[a,b]){s.security=[{token:[]}];s.components={securitySchemes:{token:{type:'apiKey',in:'header',name:s===a?'old':'new'}}};}});assert(rules(r).includes('manual-review'));});
test('readOnly property not required in requests',()=>{const r=pair((b,a)=>{for(const s of[a,b])s.paths['/pets'].get.requestBody={content:{'application/json':{schema:{type:'object',properties:{id:{type:'string',readOnly:true}},required:s===a?[]:['id']}}}};});assert.equal(r.counts.breaking,0);});
test('writeOnly property not required in response',()=>{const r=pair((b,a)=>{response(a).properties.name.writeOnly=true;response(b).properties.name.writeOnly=true;response(b).required=[];});assert.equal(r.counts.breaking,0);});
test('constraint direction and media removal',()=>{assert.equal(pair((b,a)=>{response(a).properties.name.maxLength=10;response(b).properties.name.maxLength=20;}).counts.breaking,1);assert(rules(pair(b=>delete b.paths['/pets'].get.responses['200'].content['application/json'])).includes('media-removed'));});
test('source matches are candidates with exact line numbers; fragments supported',()=>{const r=attachSources(pair(b=>delete b.paths['/pets'].get),[{name:'client.ts',text:'// comment\nfetch("/pets");\nlistPets();'}]);assert.deepEqual(r.findings[0].hits.map(h=>h.line),[2,3]);assert.equal(r.sourcesScanned,1);});
test('stable IDs, deterministic output and Markdown does not render HTML',()=>{const r=pair(b=>{delete b.paths['/pets'].get;});assert.equal(compareSpecs(spec(),{...spec(),paths:{}}).findings[0].id,r.findings[0].id);r.findings[0].title='<script>alert(1)</script>';assert(!markdown(r).includes('<script>'));});
test('sample includes migration tasks and source references',async()=>{const demo=JSON.parse(await readFile(new URL('../web/demo.json',import.meta.url),'utf8'));const r=attachSources(compareSpecs(demo.before,demo.after),demo.sources);assert(r.counts.breaking>=6);assert(r.findings.some(f=>f.hits.length));assert(markdown(r).includes('migration plan'));});

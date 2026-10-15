import {writeFile} from 'node:fs/promises';
const schema = {type:'object', required:['id','email','status'], properties:{id:{type:'string'}, email:{type:'string'}, status:{type:'string',enum:['active','paused']}}};
const before = {openapi:'3.0.3',info:{title:'Orbit API',version:'2026.09'},servers:[{url:'https://api.example.test/v1'}],paths:{
  '/customers':{get:{operationId:'listCustomers',parameters:[{name:'limit',in:'query',schema:{type:'integer',maximum:100}}],responses:{'200':{description:'OK',content:{'application/json':{schema:{type:'array',items:{$ref:'#/components/schemas/Customer'}}}}}}}},
  '/customers/{id}':{parameters:[{name:'id',in:'path',required:true,schema:{type:'string'}}],delete:{operationId:'deleteCustomer',responses:{'204':{description:'Deleted'}}}},
  '/invoices':{post:{operationId:'createInvoice',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['amount'],properties:{amount:{type:'number'},currency:{type:'string',enum:['EUR','USD','GBP']}}}}}},responses:{'201':{description:'Created'}}}}
},components:{schemas:{Customer:schema}}};
const after = structuredClone(before); after.info.version='2026.10';
after.paths['/customers'].get.parameters[0].schema.maximum=50;
after.paths['/customers'].get.parameters.push({name:'workspace',in:'header',required:true,schema:{type:'string'}});
delete after.components.schemas.Customer.properties.email;
after.components.schemas.Customer.required=['id','status'];
after.components.schemas.Customer.properties.status.enum.push('archived');
delete after.paths['/customers/{id}'].delete;
after.paths['/invoices'].post.requestBody.content['application/json'].schema.required.push('currency');
after.paths['/invoices'].post.requestBody.content['application/json'].schema.properties.currency.enum=['EUR','USD'];
after.paths['/health']={get:{operationId:'getHealth',responses:{'200':{description:'Healthy'}}}};
for(const [name,spec] of [['before',before],['after',after]]) await writeFile(new URL(`${name}.json`,import.meta.url),JSON.stringify(spec,null,2)+'\n');
await writeFile(new URL('../web/demo.json',import.meta.url),JSON.stringify({before,after,sources:[{name:'src/orbit-client.ts',text:'export async function listCustomers() {\n  const response = await fetch("/customers?limit=100");\n  const rows = await response.json();\n  return rows.map(customer => customer.email.toLowerCase());\n}\n\nexport const deleteCustomer = id => fetch(`/customers/${id}`, { method: "DELETE" });\nexport const createInvoice = amount => fetch("/invoices", {method: "POST", body: JSON.stringify({amount})});\n'}]},null,2)+'\n');

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const app=Fastify({bodyLimit:1024*1024*1024});
const uploads=join(process.cwd(),'uploads');
if(!existsSync(uploads))mkdirSync(uploads);
app.addContentTypeParser(['application/octet-stream','application/pdf'],(request,payload,done)=>done(null,payload));
await app.register(fastifyStatic,{root:process.cwd()});
app.post('/api/uploads/:id',async(request,reply)=>{
 const id=request.params.id.replace(/[^a-zA-Z0-9_-]/g,''),part=Number(request.headers['x-part-number']);
 if(!id||!Number.isInteger(part)||part<0)return reply.code(400).send({error:'Invalid upload part.'});
 await pipeline(request.body,createWriteStream(join(uploads,`${id}.${part}.part`)));
 return {ok:true,part};
});
app.post('/api/uploads/:id/complete',async(request,reply)=>{
 const id=request.params.id.replace(/[^a-zA-Z0-9_-]/g,''),{name,parts}=request.body||{};
 if(!id||!Number.isInteger(parts)||parts<1)return reply.code(400).send({error:'Invalid completion request.'});
 const safeName=String(name||'document.pdf').replace(/[^\w. -]/g,'_'),finalPath=join(uploads,`${id}-${safeName}`),output=createWriteStream(finalPath);
 for(let i=0;i<parts;i++){const path=join(uploads,`${id}.${i}.part`);if(!existsSync(path))return reply.code(400).send({error:`Part ${i} is missing.`});await pipeline(createReadStream(path),output,{end:false});unlinkSync(path)}
 output.end();return {ok:true,file:`/uploads/${encodeURIComponent(`${id}-${safeName}`)}`,bytes:statSync(finalPath).size};
});
app.listen({port:Number(process.env.PORT||3000),host:'0.0.0.0'});
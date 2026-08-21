import Fastify from 'fastify';
import cors from '@fastify/cors';
import statik from '@fastify/static';
import { Pool } from 'pg';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=Fastify({logger:true,bodyLimit:60*1024*1024});
const PORT=Number(process.env.PORT||3000);
const DATA_DIR=process.env.DATA_DIR||'/data';
const MAX_FILE_SIZE=Number(process.env.MAX_FILE_SIZE||10*1024**3);
const pool=new Pool({connectionString:process.env.DATABASE_URL||'postgres://revo:revo@postgres:5432/revoflip'});
const p=(...x)=>path.join(DATA_DIR,...x);
await Promise.all(['temp','books','covers','thumbnails'].map(x=>fs.mkdir(p(x),{recursive:true})));
await app.register(cors,{origin:true});
await app.register(statik,{root:path.join(__dirname,'public')});

async function q(sql,args=[]){return (await pool.query(sql,args)).rows}
function safeName(name='file.pdf'){return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g,'_')}

app.get('/api/health',async()=>({ok:true,storage:DATA_DIR}));
app.get('/api/books',async()=>q('SELECT id,title,original_filename,file_size,status,visibility,created_at FROM books WHERE status=$1 ORDER BY created_at DESC',['ready']));
app.get('/api/books/:id',async(req,reply)=>{const rows=await q('SELECT * FROM books WHERE id=$1',[req.params.id]);if(!rows[0])return reply.code(404).send({error:'Not found'});return rows[0]});

app.post('/api/upload/init',async(req,reply)=>{const {name,size,type,chunkSize}=req.body||{};if(type!=='application/pdf')return reply.code(400).send({error:'Hanya PDF'});if(!Number.isFinite(size)||size<1||size>MAX_FILE_SIZE)return reply.code(400).send({error:'Ukuran file tidak valid'});const id=crypto.randomUUID();const dir=p('temp',id);await fs.mkdir(dir,{recursive:true});await q('INSERT INTO uploads(id,original_filename,total_size,chunk_size,status,temp_path) VALUES($1,$2,$3,$4,$5,$6)',[id,safeName(name),size,Number(chunkSize)||50*1024*1024,'uploading',dir]);return {uploadId:id,chunkSize:Number(chunkSize)||50*1024*1024,maxFileSize:MAX_FILE_SIZE}});

app.put('/api/upload/part',async(req,reply)=>{const {uploadId,part}=req.query;const n=Number(part);if(!uploadId||!Number.isInteger(n)||n<1)return reply.code(400).send({error:'Part tidak valid'});const rows=await q('SELECT * FROM uploads WHERE id=$1',[uploadId]);const upload=rows[0];if(!upload)return reply.code(404).send({error:'Upload tidak ditemukan'});const out=path.join(upload.temp_path,`part-${String(n).padStart(8,'0')}`);const chunks=[];for await(const chunk of req.raw)chunks.push(chunk);const body=Buffer.concat(chunks);if(body.length>upload.chunk_size)return reply.code(413).send({error:'Chunk terlalu besar'});await fs.writeFile(out,body);await q('INSERT INTO upload_parts(upload_id,part_number,part_size) VALUES($1,$2,$3) ON CONFLICT(upload_id,part_number) DO UPDATE SET part_size=EXCLUDED.part_size',[uploadId,n,body.length]);const progress=(await q('SELECT COALESCE(SUM(part_size),0)::bigint AS uploaded FROM upload_parts WHERE upload_id=$1',[uploadId]))[0];return {ok:true,uploaded:Number(progress.uploaded),total:Number(upload.total_size)}});

app.get('/api/upload/:id/status',async(req,reply)=>{const rows=await q('SELECT total_size,chunk_size,status FROM uploads WHERE id=$1',[req.params.id]);if(!rows[0])return reply.code(404).send({error:'Not found'});const parts=await q('SELECT part_number FROM upload_parts WHERE upload_id=$1 ORDER BY part_number',[req.params.id]);return {...rows[0],parts:parts.map(x=>x.part_number)}});

app.post('/api/upload/complete',async(req,reply)=>{const {uploadId,title}=req.body||{};const rows=await q('SELECT * FROM uploads WHERE id=$1',[uploadId]);const upload=rows[0];if(!upload)return reply.code(404).send({error:'Upload tidak ditemukan'});const parts=await q('SELECT part_number,part_size FROM upload_parts WHERE upload_id=$1 ORDER BY part_number',[uploadId]);const total=parts.reduce((s,x)=>s+Number(x.part_size),0);if(total!==Number(upload.total_size))return reply.code(409).send({error:'Upload belum lengkap',uploaded:total,total:Number(upload.total_size)});const bookId=crypto.randomUUID();const filename=`${bookId}-${safeName(upload.original_filename)}`;const finalPath=p('books',filename);const handle=await fs.open(finalPath,'w');try{for(const part of parts){const data=await fs.readFile(path.join(upload.temp_path,`part-${String(part.part_number).padStart(8,'0')}`));await handle.write(data)} }finally{await handle.close()}
await q('INSERT INTO books(id,title,original_filename,storage_path,file_size,mime_type,status) VALUES($1,$2,$3,$4,$5,$6,$7)',[bookId,(title||upload.original_filename.replace(/\.pdf$/i,'')),upload.original_filename,finalPath,upload.total_size,'application/pdf','ready']);await q('UPDATE uploads SET status=$2,completed_at=NOW() WHERE id=$1',[uploadId,'completed']);await fs.rm(upload.temp_path,{recursive:true,force:true});return {ok:true,id:bookId,viewer:`/viewer.html?id=${bookId}`}});

app.post('/api/upload/:id/abort',async(req,reply)=>{const rows=await q('SELECT temp_path FROM uploads WHERE id=$1',[req.params.id]);if(rows[0])await fs.rm(rows[0].temp_path,{recursive:true,force:true});await q('UPDATE uploads SET status=$2 WHERE id=$1',[req.params.id,'aborted']);return {ok:true}});
app.get('/api/media/:id',async(req,reply)=>{const rows=await q('SELECT storage_path,mime_type FROM books WHERE id=$1 AND status=$2',[req.params.id,'ready']);if(!rows[0])return reply.code(404).send({error:'Not found'});reply.header('content-type',rows[0].mime_type).header('accept-ranges','bytes');return reply.send(createReadStream(rows[0].storage_path))});

app.setErrorHandler((err,req,reply)=>{req.log.error(err);reply.code(err.statusCode||500).send({error:err.message||'Server error'})});
app.listen({port:PORT,host:'0.0.0.0'});

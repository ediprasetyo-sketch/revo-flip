const MAX_FILE_SIZE = 10 * 1024 ** 3;
const CHUNK_SIZE = 10 * 1024 ** 2;
const RETRIES = 3;
const input = document.querySelector('#fileInput');
const dropzone = document.querySelector('#dropzone');
const info = document.querySelector('#fileInfo');
const nameEl = document.querySelector('#fileName');
const sizeEl = document.querySelector('#fileSize');
const bar = document.querySelector('#progressBar');
const progress = document.querySelector('#progressText');
const speed = document.querySelector('#speedText');
const start = document.querySelector('#startUpload');
const status = document.querySelector('#status');
let file;
const key = f => `revoflip:${f.name}:${f.size}:${f.lastModified}`;
function formatSize(n){const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${n.toFixed(i?2:0)} ${u[i]}`}
function errorFromResponse(r,fallback){return r.json().then(x=>x.error||fallback).catch(()=>fallback)}
async function blobToBase64(blob){const buffer=await blob.arrayBuffer();const bytes=new Uint8Array(buffer);let binary='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(binary)}
function selectFile(f){if(!f)return;if(f.type&&f.type!=='application/pdf'&&!/\.pdf$/i.test(f.name)){status.textContent='Hanya file PDF yang didukung.';return}if(f.size>MAX_FILE_SIZE){status.textContent='Ukuran file melebihi batas 10 GB.';return}file=f;nameEl.textContent=f.name;sizeEl.textContent=formatSize(f.size);info.hidden=false;status.textContent=localStorage.getItem(key(f))?'Sesi upload sebelumnya ditemukan. Klik Mulai Upload untuk melanjutkan.':'Siap diunggah.'}
async function retry(fn){let last;for(let i=0;i<RETRIES;i++){try{return await fn()}catch(err){last=err;if(i<RETRIES-1)await new Promise(r=>setTimeout(r,700*(i+1)))}}throw last}
input.addEventListener('change',e=>selectFile(e.target.files[0]));
['dragenter','dragover'].forEach(t=>dropzone.addEventListener(t,e=>{e.preventDefault();dropzone.classList.add('dragging')}));
['dragleave','drop'].forEach(t=>dropzone.addEventListener(t,e=>{e.preventDefault();dropzone.classList.remove('dragging')}));
dropzone.addEventListener('drop',e=>selectFile(e.dataTransfer.files[0]));
start.addEventListener('click',async()=>{if(!file)return;start.disabled=true;const storageKey=key(file);const started=performance.now();try{let session=JSON.parse(localStorage.getItem(storageKey)||'null');if(!session){const r=await fetch('/api/upload/init',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:file.name,size:file.size,type:'application/pdf',chunkSize:CHUNK_SIZE})});if(!r.ok)throw new Error(await errorFromResponse(r,'Gagal membuat sesi upload'));session=await r.json();localStorage.setItem(storageKey,JSON.stringify(session))}const chunkSize=Number(session.chunkSize)||CHUNK_SIZE;const st=await fetch(`/api/upload/${encodeURIComponent(session.uploadId)}/status`);if(!st.ok){localStorage.removeItem(storageKey);throw new Error(await errorFromResponse(st,'Sesi upload tidak tersedia'))}const state=await st.json();const done=new Set(state.parts.map(Number));const totalParts=Math.ceil(file.size/chunkSize);let uploaded=0;for(const part of done){const off=(part-1)*chunkSize;uploaded+=Math.max(0,Math.min(chunkSize,file.size-off))}for(let part=1;part<=totalParts;part++){if(done.has(part))continue;const offset=(part-1)*chunkSize;const chunk=file.slice(offset,Math.min(offset+chunkSize,file.size),'application/octet-stream');await retry(async()=>{const data=await blobToBase64(chunk);const r=await fetch(`/api/upload/part?uploadId=${encodeURIComponent(session.uploadId)}&part=${part}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({data})});if(!r.ok)throw new Error(await errorFromResponse(r,`Part ${part} gagal (${r.status})`))});uploaded+=chunk.size;const pct=uploaded/file.size*100;bar.style.width=`${pct}%`;progress.textContent=`${pct.toFixed(1)}% — bagian ${part}/${totalParts}`;const secs=(performance.now()-started)/1000;speed.textContent=`${formatSize(uploaded/Math.max(secs,.1))}/s`}const complete=await fetch('/api/upload/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({uploadId:session.uploadId,title:file.name.replace(/\.pdf$/i,'')})});if(!complete.ok)throw new Error(await errorFromResponse(complete,'Gagal menyelesaikan upload'));const result=await complete.json();localStorage.removeItem(storageKey);bar.style.width='100%';progress.textContent='100% — selesai';status.textContent='Upload berhasil. Membuka flipbook…';setTimeout(()=>location.href=result.viewer,350)}catch(err){status.textContent=`Upload terhenti: ${err.message}. Pilih file yang sama dan klik Mulai Upload untuk melanjutkan.`}finally{start.disabled=false}});
import http from 'node:http';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { validateJobInput, collectSources } from './lib/input.mjs';
import { generateBrief, cancelGeneration, inspectCodex } from './lib/generator.mjs';
import { makeZip } from './lib/zip.mjs';
import { prepareVisualAssets } from './lib/media.mjs';
import { resolveOutputPath } from './lib/output-path.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)), PUBLIC=path.join(ROOT,'public'), OUTPUTS=path.join(ROOT,'outputs'), JOBS_FILE=path.join(OUTPUTS,'jobs.json');
const HOST='127.0.0.1', PORT=Number(process.env.PORT||8826), ALLOWED_HOSTS=new Set([`${HOST}:${PORT}`,`localhost:${PORT}`]);
const jobs=new Map(); let active=null, queue=[];
let codexStatus='checking';
const cleanJob=j=>({id:j.id,status:j.status,stage:j.stage,personName:j.personName,createdAt:j.createdAt,updatedAt:j.updatedAt,error:j.error||undefined,concepts:j.concepts||undefined,visualRev:j.visualRev||undefined,proposalUrl:j.status==='completed'?`/outputs/${j.id}/proposal/index.html`:undefined,downloadUrl:j.status==='completed'?`/api/jobs/${j.id}/download`:undefined});

async function persist(){const tmp=JOBS_FILE+'.tmp';await mkdir(OUTPUTS,{recursive:true});await writeFile(tmp,JSON.stringify([...jobs.values()],null,2));await rename(tmp,JOBS_FILE);}
async function load(){await mkdir(OUTPUTS,{recursive:true});try{const stored=JSON.parse(await readFile(JOBS_FILE,'utf8'));for(const j of stored){if(['queued','extracting','generating','collecting','analyzing','rendering'].includes(j.status)){j.status='failed';j.stage='failed';j.error='Server restarted before this job completed.';}jobs.set(j.id,j);}await persist();}catch(e){if(e.code!=='ENOENT')console.error('Could not load jobs:',e.message);}}
function send(res,status,body,headers={}){const data=Buffer.isBuffer(body)?body:Buffer.from(typeof body==='string'?body:JSON.stringify(body));res.writeHead(status,{'content-type':Buffer.isBuffer(body)?'application/octet-stream; charset=utf-8':'application/json; charset=utf-8','content-length':data.length,'x-content-type-options':'nosniff','cache-control':'no-store',...headers});res.end(data);}
function safeError(e){if(e?.name==='AbortError')return 'Generation was cancelled.';return String(e?.message||e).replace(/[\r\n]+/g,' ').slice(0,1000);}
async function bodyJson(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>64*1024*1024)throw Object.assign(new Error('Request body exceeds 64 MB'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
function mutatingAllowed(req){const origin=req.headers.origin;if(origin&&!new Set([`http://${HOST}:${PORT}`,`http://localhost:${PORT}`]).has(origin))return false;return String(req.headers['content-type']||'').toLowerCase().startsWith('application/json');}
function within(root,target){const rel=path.relative(root,target);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
async function staticFile(res,root,urlPath){let decoded;try{decoded=decodeURIComponent(urlPath);}catch{return false;}const rel=decoded.replace(/^\/+/,''),target=path.resolve(root,rel);if(!within(root,target))return false;try{const s=await stat(target),file=s.isDirectory()?path.join(target,'index.html'):target;if(!within(root,file))return false;const data=await readFile(file);send(res,200,data,{'content-type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-cache'});return true;}catch{return false;}}

async function processQueue(){
  if(active||!queue.length)return;
  const id=queue.shift(),job=jobs.get(id);if(!job||job.status!=='queued')return processQueue();active=id;
  try{
    job.status='collecting';job.stage='collecting';job.updatedAt=new Date().toISOString();await persist();
    const outDir=path.join(OUTPUTS,id),input=JSON.parse(await readFile(path.join(outDir,'input.json'),'utf8'));
    const collected=await collectSources(input),visual=await prepareVisualAssets(input,collected,outDir),sources=collected.map(({imageCandidates,...source})=>source);
    const visualContext=JSON.stringify(visual.assets.map(a=>({role:a.role,alt:a.alt,caption:a.caption,subjectVerified:a.subjectVerified,sourcePageUrl:a.sourcePageUrl})));
    job.status='analyzing';job.stage='analyzing';await persist();
    const brief=await generateBrief({...input,visualContext},sources,{jobId:id,onStage:s=>{job.stage=s;}});brief.visual=visual;brief.metadata={provider:input.provider,createdAt:new Date().toISOString(),inputName:input.personName};job.personName=brief.person.name||job.personName;job.concepts=brief.concepts.map(x=>({id:x.id,name:x.name,label:x.label}));await writeFile(path.join(outDir,'brief.json'),JSON.stringify(brief,null,2));
    job.status='rendering';job.stage='rendering';await persist();const {renderBundle}=await import('./lib/render.mjs');await renderBundle(brief,outDir);job.status='completed';job.stage='completed';job.updatedAt=new Date().toISOString();await persist();
  }catch(e){job.status=e?.name==='AbortError'?'cancelled':'failed';job.stage=job.status;job.error=safeError(e);job.updatedAt=new Date().toISOString();await persist();}finally{active=null;setImmediate(processQueue);}
}

await load(); inspectCodex().then(status=>{codexStatus=status;});
const server=http.createServer(async(req,res)=>{try{const host=String(req.headers.host||'').toLowerCase();if(!ALLOWED_HOSTS.has(host))return send(res,403,{error:'Invalid Host header'});const url=new URL(req.url,`http://${host}`),p=url.pathname;
  if(req.method==='GET'&&p==='/api/health')return send(res,200,{ok:true,provider:'codex',codex:codexStatus,limits:{urls:5,pdfs:3,pdfBytes:8388608,photos:5,photoBytes:4194304,requestBytes:67108864},activeJob:active,queued:queue.length});
  if(req.method==='GET'&&p==='/api/jobs')return send(res,200,{jobs:[...jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(cleanJob)});
  let m=p.match(/^\/api\/jobs\/([0-9a-f-]+)$/);if(req.method==='GET'&&m){const j=jobs.get(m[1]);return j?send(res,200,{job:cleanJob(j)}):send(res,404,{error:'Job not found'});}
  m=p.match(/^\/api\/jobs\/([0-9a-f-]+)\/download$/);if(req.method==='GET'&&m){const j=jobs.get(m[1]);if(!j)return send(res,404,{error:'Job not found'});if(j.status!=='completed')return send(res,409,{error:'Job is not complete'});const zip=await makeZip(path.join(OUTPUTS,j.id));return send(res,200,zip,{'content-type':'application/zip','content-disposition':`attachment; filename="knowledgeweb-${j.id}.zip"`});}
  if(req.method==='POST'&&p==='/api/jobs'){if(!mutatingAllowed(req))return send(res,403,{error:'Cross-origin or non-JSON request rejected'});const input=validateJobInput(await bodyJson(req));const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');const duplicate=[...jobs.values()].find(j=>j.fingerprint===fingerprint&&['queued','collecting','analyzing','rendering'].includes(j.status));if(duplicate)return send(res,409,{error:'An identical job is already active',job:cleanJob(duplicate)});const id=randomUUID(),now=new Date().toISOString(),job={id,status:'queued',stage:'queued',personName:input.personName||'資料から人物を確認中',createdAt:now,updatedAt:now,fingerprint};await mkdir(path.join(OUTPUTS,id),{recursive:false});await writeFile(path.join(OUTPUTS,id,'input.json'),JSON.stringify(input));jobs.set(id,job);queue.push(id);await persist();setImmediate(processQueue);return send(res,202,{job:cleanJob(job)});}
  m=p.match(/^\/api\/jobs\/([0-9a-f-]+)\/cancel$/);if(req.method==='POST'&&m){if(!mutatingAllowed(req))return send(res,403,{error:'Cross-origin or non-JSON request rejected'});const j=jobs.get(m[1]);if(!j)return send(res,404,{error:'Job not found'});if(j.status==='queued'){queue=queue.filter(x=>x!==j.id);j.status='cancelled';j.stage='cancelled';await persist();return send(res,200,{job:cleanJob(j)});}if(active===j.id&&cancelGeneration(j.id))return send(res,202,{job:cleanJob(j)});return send(res,409,{error:'Job cannot be cancelled in its current state'});}
  if(req.method==='GET'&&p.startsWith('/outputs/')){const output=resolveOutputPath(OUTPUTS,p);if(!output)return send(res,404,{error:'File not found'});if(await staticFile(res,output.root,output.relativePath))return;return send(res,404,{error:'File not found'});}
  if(req.method==='GET'){if(await staticFile(res,PUBLIC,p==='/'?'index.html':p))return;}
  send(res,404,{error:'Not found'});
}catch(e){console.error('Request failed:',safeError(e));send(res,e.status||400,{error:safeError(e)});}});
server.listen(PORT,HOST,()=>console.log(`CEO KnowledgeWeb Studio: http://${HOST}:${PORT}`));

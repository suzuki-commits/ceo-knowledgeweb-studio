import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPython } from './python-runtime.mjs';

const MAX_URL_BYTES = 2 * 1024 * 1024;
const entities = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };

function publicIp(address) {
  if (net.isIPv4(address)) {
    const p=address.split('.').map(Number), n=((p[0]<<24)>>>0)+(p[1]<<16)+(p[2]<<8)+p[3];
    const inRange=(a,b)=>n>=a&&n<=b;
    return !(inRange(0x00000000,0x00ffffff)||inRange(0x0a000000,0x0affffff)||inRange(0x64400000,0x647fffff)||inRange(0x7f000000,0x7fffffff)||inRange(0xa9fe0000,0xa9feffff)||inRange(0xac100000,0xac1fffff)||inRange(0xc0000000,0xc00000ff)||inRange(0xc0000200,0xc00002ff)||inRange(0xc0a80000,0xc0a8ffff)||inRange(0xc6120000,0xc613ffff)||inRange(0xc6336400,0xc63364ff)||inRange(0xcb007100,0xcb0071ff)||inRange(0xe0000000,0xffffffff));
  }
  if (net.isIPv6(address)) {
    const a=address.toLowerCase();
    return !(a==='::'||a==='::1'||a.startsWith('fc')||a.startsWith('fd')||a.startsWith('fe8')||a.startsWith('fe9')||a.startsWith('fea')||a.startsWith('feb')||a.startsWith('ff')||a.startsWith('2001:db8:')||a.startsWith('::ffff:'));
  }
  return false;
}

async function resolvePublic(hostname) {
  if (net.isIP(hostname)) { if (!publicIp(hostname)) throw new Error('Private or reserved IP addresses are not allowed'); return [{address:hostname,family:net.isIPv6(hostname)?6:4}]; }
  const records = await dns.lookup(hostname, { all:true, verbatim:true });
  if (!records.length || records.some(r=>!publicIp(r.address))) throw new Error('URL hostname resolves to a private or reserved address');
  return records;
}

function decodeHtml(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&#(x?[0-9a-f]+);|&([a-z]+);/gi,(_,num,name)=>num?String.fromCodePoint(parseInt(num.replace(/^x/i,''),num[0].toLowerCase()==='x'?16:10)):(entities[name.toLowerCase()]||' ')).replace(/\s+/g,' ').trim();
}

function imageCandidates(html, pageUrl) {
  const found=[];
  const attr=(text,name)=>{const match=text.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,'i'));return match?.[1]??match?.[2]??'';};
  const push=(src,alt='',context='')=>{try{const url=new URL(src,pageUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;const decodedAlt=decodeHtml(alt),decodedContext=decodeHtml(context).slice(0,500),existing=found.find(x=>x.url===url.href);if(existing){if(decodedAlt.length>existing.alt.length)existing.alt=decodedAlt;if(decodedContext.length>existing.context.length)existing.context=decodedContext;}else found.push({url:url.href,alt:decodedAlt,context:decodedContext});}catch{}};
  for(const match of html.matchAll(/<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["'][^>]*>/gi))push(match[1],'','social preview');
  for(const match of html.matchAll(/<meta\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/gi))push(match[1],'','social preview');
  for(const match of html.matchAll(/<img\b([^>]*)>/gi)){const attrs=match[1],src=attr(attrs,'src'),alt=attr(attrs,'alt');if(src)push(src,alt,attrs);}
  return found.slice(0,20);
}

export async function fetchPublicText(rawUrl, redirects=0) {
  if (redirects>4) throw new Error('Too many redirects');
  let url; try { url=new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only credential-free HTTP(S) URLs are allowed');
  const records=await resolvePublic(url.hostname); const chosen=records[0]; const client=url.protocol==='https:'?https:http;
  return await new Promise((resolve,reject)=>{
    const req=client.request(url,{method:'GET',headers:{'user-agent':'CEO-KnowledgeWeb-Studio/1.0','accept':'text/html,text/plain;q=0.9'},timeout:10000,lookup:(_h,options,cb)=>options?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family),servername:url.hostname},res=>{
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) { res.resume(); resolve(fetchPublicText(new URL(res.headers.location,url).href,redirects+1)); return; }
      if (res.statusCode<200||res.statusCode>=300) { res.resume(); reject(new Error(`URL returned HTTP ${res.statusCode}`)); return; }
      const contentType=String(res.headers['content-type']||'').toLowerCase(); if(!contentType.includes('text/html')&&!contentType.includes('text/plain')&&!contentType.includes('application/xhtml')){res.resume();reject(new Error('URL is not an HTML or text document'));return;}
      const chunks=[]; let size=0; res.on('data',c=>{size+=c.length;if(size>MAX_URL_BYTES){req.destroy(new Error('URL response exceeds 2 MB'));}else chunks.push(c);}); res.on('end',()=>{const raw=Buffer.concat(chunks).toString('utf8');const body=contentType.includes('html')?decodeHtml(raw):raw.replace(/\s+/g,' ').trim();if(!body)reject(new Error('URL contains no readable text'));else resolve({url:url.href,text:body.slice(0,120000),imageCandidates:contentType.includes('html')?imageCandidates(raw,url.href):[]});});
    }); req.on('timeout',()=>req.destroy(new Error('URL request timed out'))); req.on('error',reject); req.end();
  });
}

export async function fetchPublicImage(rawUrl, redirects=0) {
  if(redirects>4)throw new Error('Too many redirects');
  let url;try{url=new URL(rawUrl);}catch{throw new Error('Invalid image URL');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Only credential-free HTTP(S) image URLs are allowed');
  const records=await resolvePublic(url.hostname),chosen=records[0],client=url.protocol==='https:'?https:http;
  return await new Promise((resolve,reject)=>{const req=client.request(url,{method:'GET',headers:{'user-agent':'CEO-KnowledgeWeb-Studio/1.0','accept':'image/jpeg,image/png,image/webp'},timeout:10000,lookup:(_h,o,cb)=>o?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family),servername:url.hostname},res=>{
    if([301,302,303,307,308].includes(res.statusCode)&&res.headers.location){res.resume();resolve(fetchPublicImage(new URL(res.headers.location,url).href,redirects+1));return;}
    if(res.statusCode<200||res.statusCode>=300){res.resume();reject(new Error(`Image returned HTTP ${res.statusCode}`));return;}
    const chunks=[];let size=0;res.on('data',c=>{size+=c.length;if(size>4*1024*1024)req.destroy(new Error('Image exceeds 4 MB'));else chunks.push(c);});res.on('end',()=>resolve({url:url.href,contentType:String(res.headers['content-type']||''),data:Buffer.concat(chunks)}));
  });req.on('timeout',()=>req.destroy(new Error('Image request timed out')));req.on('error',reject);req.end();});
}

export async function extractPdf(pdf) {
  if (!pdf || typeof pdf.name!=='string'||typeof pdf.base64!=='string') throw new Error('Invalid PDF payload');
  const data=Buffer.from(pdf.base64,'base64'); if(!data.length||data.length>8*1024*1024) throw new Error(`${pdf.name}: PDF must be between 1 byte and 8 MB`); if(data.subarray(0,5).toString()!=='%PDF-')throw new Error(`${pdf.name}: file is not a PDF`);
  const dir=await mkdtemp(path.join(tmpdir(),'ceo-studio-')); const file=path.join(dir,'input.pdf');
  try { await writeFile(file,data,{mode:0o600}); const script="import sys\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1])\nprint('\\n'.join((p.extract_text() or '') for p in r.pages))"; const extracted=(await runPython(script,[file])).replace(/\s+/g,' ').trim(); if(extracted.length<20)throw new Error(`${pdf.name}: readable text was not found. OCR is not implemented; use a text PDF.`); return extracted.slice(0,120000); } finally { await rm(dir,{recursive:true,force:true}); }
}

export async function collectSources(input) {
  const sources=[]; let n=1; const add=(type,label,url,text,extra={})=>sources.push({id:`S${String(n++).padStart(2,'0')}`,type,label,url,retrievedAt:new Date().toISOString(),text,...extra});
  const urls=[...new Set((input.urls||[]).map(x=>String(x).trim()).filter(Boolean))]; if(urls.length>5)throw new Error('At most 5 URLs are allowed');
  for(const raw of urls){const page=await fetchPublicText(raw);add('url',new URL(page.url).hostname,page.url,page.text,{imageCandidates:page.imageCandidates||[]});}
  const pdfs=input.pdfs||[]; if(!Array.isArray(pdfs)||pdfs.length>3)throw new Error('At most 3 PDFs are allowed'); for(const pdf of pdfs)add('pdf',path.basename(pdf.name).slice(0,120),'',await extractPdf(pdf));
  const notes=String(input.notes||'').trim(); if(notes)add('text','入力テキスト','',notes.slice(0,120000));
  return sources;
}

export function validateJobInput(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('JSON object required');
  const personName=String(input.personName||'').trim(); if(personName.length>100)throw new Error('personName must be 100 characters or fewer');
  const company=String(input.company||'').trim().slice(0,200), title=String(input.title||'').trim().slice(0,200), notes=String(input.notes||''); if(notes.length>200000)throw new Error('notes is too long');
  const provider=input.provider||'codex'; if(!['codex','demo'].includes(provider))throw new Error('provider must be codex or demo');
  if(!Array.isArray(input.urls||[])||!(input.urls||[]).every(x=>typeof x==='string'))throw new Error('urls must be an array of strings');
  const photos=input.photos||[];if(!Array.isArray(photos)||photos.length>5)throw new Error('At most 5 photos are allowed');
  const roles=new Set(['portrait','work','community','sport','context']);
  for(const photo of photos){if(!photo||typeof photo.name!=='string'||typeof photo.base64!=='string')throw new Error('Invalid photo payload');if(!['image/jpeg','image/png','image/webp'].includes(photo.mime))throw new Error(`${photo.name}: invalid photo MIME type`);if(!roles.has(photo.role))throw new Error('Invalid photo role');if(Buffer.byteLength(photo.base64,'base64')>4*1024*1024)throw new Error(`${photo.name}: photo exceeds 4 MB`);}
  const hasMaterial=(input.urls||[]).some(x=>x.trim())||(input.pdfs||[]).length>0||photos.length>0||notes.trim(); if(!personName&&!hasMaterial)throw new Error('Enter a personName or provide a URL, PDF, photo, or text source');
  return {personName,company,title,urls:input.urls||[],notes,pdfs:input.pdfs||[],photos,provider};
}
